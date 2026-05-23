const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://gdotgcrtivjdpkcchrro.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdkb3RnY3J0aXZqZHBrY2NocnJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NjAyMTQsImV4cCI6MjA5NTAzNjIxNH0._mW_DCZiK_94zHNVEdzUrrBRaAEYohrPfagrdSFiJeU';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log('Signing in...');
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'admin@sanhlongvetco.vn',
    password: 'Admin@SanhLong2026!'
  });

  if (signInError) {
    console.error('Sign in error:', signInError);
    return;
  }

  const user = signInData.user;
  console.log('Signed in successfully. User ID:', user.id);

  console.log('Querying profile...');
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, branch_id, team_id, auth_providers, is_active')
    .eq('id', user.id)
    .single();

  if (profileError) {
    console.error('Profile query error:', profileError);
  } else {
    console.log('Profile query success:', profileData);
  }

  console.log('Querying user_roles...');
  const { data: roleData, error: roleError } = await supabase
    .from('user_roles')
    .select('role:roles(code, name)')
    .eq('user_id', user.id);

  if (roleError) {
    console.error('User roles query error:', roleError);
  } else {
    console.log('User roles success:', JSON.stringify(roleData, null, 2));
  }
}

run();
