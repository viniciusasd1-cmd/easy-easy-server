'use strict';

const { createClient } = require('@supabase/supabase-js');
const { config } = require('./config');

let client;

function getSupabase() {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}

function unwrap({ data, error }, context) {
  if (error) {
    const wrapped = new Error(`${context}: ${error.message}`);
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}

module.exports = { getSupabase, unwrap };
