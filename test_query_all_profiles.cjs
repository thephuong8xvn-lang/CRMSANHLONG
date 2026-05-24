const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://gdotgcrtivjdpkcchrro.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdkb3RnY3J0aXZqZHBrY2NocnJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjAyMTQsImV4cCI6MjA5NTAzNjIxNH0._mW_DCZiK_94zHNVEdzUrrBRaAEYohrPfagrdSFiJeU';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log('Signing in as admin...');
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'admin@sanhlongvetco.vn',
    password: 'Admin@SanhLong2026!'
  });

  if (signInError) {
    console.error('Sign in error:', signInError);
    return;
  }

  console.log('Querying all profiles...');
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select(`
      id, email, full_name, phone, employee_code, job_title, is_active, avatar_url, branch_id, team_id,
      branch:branches!profiles_branch_id_fkey(id, name),
      team:teams!profiles_team_id_fkey(id, name),
      user_roles:user_roles!user_roles_user_id_fkey(
        role:roles(id, code, name)
      )
    `);

  if (profilesError) {
    console.error('Profiles query error:', profilesError);
  } else {
    console.log('Profiles query success. Count:', profiles.length);
    console.log('Profiles data:', JSON.stringify(profiles, null, 2));
  }
}

run();
