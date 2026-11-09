// Connection to the Supabase project that stores the register.
// The publishable key is meant to be public: the database's security rules
// only let the team account read or change the register.
// teamEmail is the shared team account; its password is the team code people type.
// Never put the secret (service_role) key or the team code here.
window.REGISTER_CONFIG = {
  url: 'https://axxqqoqlwremtxlehgvt.supabase.co',
  anonKey: 'sb_publishable_XZPwFjqS4J_I0xj0hVSifQ_GkrIm2jk',
  teamEmail: 'team@risk-register.app'
};
