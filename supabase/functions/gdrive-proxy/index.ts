// ============================================================
// Edge Function: gdrive-proxy
// Proxy DUY NHẤT giữa CRM và Google Drive/Sheets.
// Credential service account CHỈ tồn tại ở đây (secrets), không bao giờ ra frontend.
//
// Bảo mật nhiều lớp:
//   1. Verify Supabase JWT của người gọi (phải đăng nhập).
//   2. Kiểm quyền 'inventory.receive' (hoặc admin) qua RPC chạy dưới danh tính user.
//   3. Whitelist: mọi thao tác PHẢI gắn source_id đã cấu hình trong gdrive_sources;
//      file phải nằm trong cây thư mục của source đó (chống đọc file tùy ý / SSRF).
//
// Actions: list-files | sheet-info | read-sheet | write-cells
//
// Secrets cần đặt (supabase secrets set):
//   GOOGLE_SA_EMAIL        — email service account
//   GOOGLE_SA_PRIVATE_KEY  — private key PEM (PKCS8) của service account
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY có sẵn trong runtime.)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Google service account: ký JWT (RS256) → đổi lấy access_token ──
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function b64url(input: string | Uint8Array): string {
  let str: string
  if (typeof input === 'string') {
    str = btoa(unescape(encodeURIComponent(input)))
  } else {
    let s = ''
    for (let i = 0; i < input.length; i++) s += String.fromCharCode(input[i])
    str = btoa(s)
  }
  return str.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

let cachedToken: { token: string; exp: number } | null = null

async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token

  const email = Deno.env.get('GOOGLE_SA_EMAIL')
  let privateKey = Deno.env.get('GOOGLE_SA_PRIVATE_KEY') ?? ''
  if (!email || !privateKey) throw new Error('Thiếu GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY (secrets).')
  // Secrets thường lưu \n literal → khôi phục xuống dòng thật
  privateKey = privateKey.replace(/\\n/g, '\n')

  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${b64url(new Uint8Array(sigBuf))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`Lỗi lấy token Google: ${res.status} ${await res.text()}`)
  const data = await res.json()
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 3600) }
  return cachedToken.token
}

// ── Drive/Sheets helpers ──
async function gfetch(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`)
  return res.json()
}

// Kiểm tra file (fileId) nằm trong cây thư mục gốc (rootFolderId) — chống truy cập file tùy ý.
// Dùng truy vấn `list` (giống list-files) thay vì files.get?fields=parents, vì với file
// được SHARE (nằm trong My Drive người khác) thì parents thường rỗng qua files.get → sai.
async function fileIsUnderFolder(token: string, fileId: string, rootFolderId: string): Promise<boolean> {
  const sheets = await listSheetsRecursive(token, rootFolderId)
  return sheets.some((f) => f.id === fileId)
}

// Liệt kê Google Sheets trong thư mục + thư mục con (đệ quy giới hạn độ sâu)
async function listSheetsRecursive(token: string, folderId: string, depth = 0): Promise<any[]> {
  if (depth > 3) return []
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`)
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&fields=files(id,name,mimeType,modifiedTime)&pageSize=200` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=modifiedTime desc`
  const data = await gfetch(token, url)
  const files: any[] = data.files ?? []
  const out: any[] = []
  for (const f of files) {
    if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
      out.push({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })
    } else if (f.mimeType === 'application/vnd.google-apps.folder') {
      const sub = await listSheetsRecursive(token, f.id, depth + 1)
      out.push(...sub)
    }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Thiếu Authorization.' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Client chạy DƯỚI DANH TÍNH user (để kiểm tra auth + quyền theo RLS/RPC)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    // Phải truyền token TƯỜNG MINH: getUser() không tham số đọc session từ storage
    // (không tồn tại ở edge runtime stateless) → luôn null dù có JWT hợp lệ.
    const accessToken = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userErr } = await userClient.auth.getUser(accessToken)
    if (userErr || !userData?.user) return json({ error: 'Phiên đăng nhập không hợp lệ.' }, 401)

    // Kiểm quyền: admin hoặc inventory.receive (RPC dùng auth.uid() của user)
    const { data: hasPerm } = await userClient.rpc('fn_has_permission', { p_perm_code: 'inventory.receive' })
    const { data: isAdmin } = await userClient.rpc('fn_is_admin')
    if (!hasPerm && !isAdmin) return json({ error: 'Không có quyền nhập kho (inventory.receive).' }, 403)

    const body = await req.json().catch(() => ({}))
    const action: string = body.action
    const sourceId: string | undefined = body.source_id
    if (!action || !sourceId) return json({ error: 'Thiếu action hoặc source_id.' }, 400)

    // Whitelist: source phải tồn tại & active. Dùng service client để đọc folder gốc.
    const admin = createClient(supabaseUrl, serviceKey)
    const { data: source, error: srcErr } = await admin
      .from('gdrive_sources')
      .select('id, drive_folder_id, is_active')
      .eq('id', sourceId)
      .single()
    if (srcErr || !source || !source.is_active) return json({ error: 'Nguồn Drive không hợp lệ hoặc đã tắt.' }, 400)
    const rootFolderId: string = source.drive_folder_id

    const token = await getGoogleAccessToken()

    // ── list-files: liệt kê Sheet trong thư mục source ──
    if (action === 'list-files') {
      const files = await listSheetsRecursive(token, rootFolderId)
      return json({ files })
    }

    // Các action còn lại thao tác trên 1 file cụ thể → bắt buộc whitelist file
    const fileId: string | undefined = body.file_id
    if (!fileId) return json({ error: 'Thiếu file_id.' }, 400)
    const allowed = await fileIsUnderFolder(token, fileId, rootFolderId)
    if (!allowed) return json({ error: 'File không thuộc thư mục đã cấu hình.' }, 403)

    // ── sheet-info: danh sách tab + tiêu đề ──
    if (action === 'sheet-info') {
      const meta = await gfetch(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=properties.title,sheets.properties(title,sheetId,gridProperties)`,
      )
      const tabs = (meta.sheets ?? []).map((s: any) => ({
        title: s.properties.title,
        rows: s.properties.gridProperties?.rowCount ?? 0,
        cols: s.properties.gridProperties?.columnCount ?? 0,
      }))
      return json({ title: meta.properties?.title ?? '', tabs })
    }

    // ── read-sheet: đọc toàn bộ giá trị 1 tab ──
    if (action === 'read-sheet') {
      const tab: string = body.tab
      if (!tab) return json({ error: 'Thiếu tab.' }, 400)
      const range = encodeURIComponent(tab)
      const data = await gfetch(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      )
      return json({ values: data.values ?? [] })
    }

    // ── write-cells: ghi ngược các ô (2 chiều) ──
    if (action === 'write-cells') {
      const updates: { range: string; values: any[][] }[] = body.updates ?? []
      if (!Array.isArray(updates) || updates.length === 0) return json({ error: 'Không có ô nào để ghi.' }, 400)
      const result = await gfetch(
        token,
        `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
        },
      )
      return json({ ok: true, updatedCells: result.totalUpdatedCells ?? 0 })
    }

    return json({ error: `Action không hỗ trợ: ${action}` }, 400)
  } catch (e) {
    console.error('[gdrive-proxy] error:', e)
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
