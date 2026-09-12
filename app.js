function handleCredentialResponse(response) {
  var token = response.credential;
  var payload = parseJWT(token);

  if (!payload || !payload.email || payload.email.toLowerCase().indexOf(CONFIG.ALLOWED_DOMAIN) === -1) {
  if (!payload || !payload.email || !payload.email.toLowerCase().endsWith(CONFIG.ALLOWED_DOMAIN)) {
    showLoginError('เฉพาะอีเมล @kku.ac.th เท่านั้น');
    return;
  }
