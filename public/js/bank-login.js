(function(){
  const authModes = document.querySelectorAll('.auth-mode');
  const signupFields = document.querySelectorAll('.signup-only');
  const titleEl = document.getElementById('authTitle');
  const subtitleEl = document.getElementById('authSubtitle');
  const form = document.getElementById('sassLoginForm');
  const passwordInput = document.getElementById('sassLoginPassword');
  const togglePassword = document.getElementById('sassTogglePassword');
  const twoFactorToggle = document.getElementById('sassTwoFactorToggle');
  const otpSection = document.getElementById('sassOtpSection');
  const otpInputs = Array.from(document.querySelectorAll('.sass-otp-input'));
  const rememberMe = document.getElementById('sassRememberMe');
  const submitButton = document.getElementById('submitButton');
  const alertBox = document.getElementById('sassAlert');

  let mode = 'login';

  function showAlert(type, message){
    if (!alertBox) return;
    alertBox.classList.remove('hidden');
    alertBox.classList.toggle('success', type === 'success');
    alertBox.classList.toggle('error', type === 'error');
    alertBox.textContent = message;
  }

  function clearAlert(){
    if (!alertBox) return;
    alertBox.classList.add('hidden');
    alertBox.textContent = '';
    alertBox.classList.remove('success', 'error');
  }

  function setMode(nextMode){
    mode = nextMode;
    authModes.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    signupFields.forEach(el => {
      el.style.display = mode === 'register' ? '' : 'none';
    });
    if (titleEl) titleEl.textContent = mode === 'login' ? 'Welcome Back' : 'Create your profile';
    if (subtitleEl) subtitleEl.textContent = mode === 'login'
      ? 'Access your Delco Tech Division accounts securely.'
      : 'Register to start your Delco Tech Division banking experience.';
    if (submitButton) submitButton.textContent = mode === 'login' ? 'Secure Login' : 'Create Account';
  }

  authModes.forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  togglePassword?.addEventListener('click', () => {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    togglePassword.innerHTML = type === 'text'
      ? '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd" /><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" /></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" /></svg>';
  });

  twoFactorToggle?.addEventListener('change', () => {
    if (twoFactorToggle.checked) {
      otpSection.classList.add('sass-active');
    } else {
      otpSection.classList.remove('sass-active');
      otpInputs.forEach(input => input.value = '');
    }
  });

  otpInputs.forEach((input, index) => {
    input.addEventListener('focus', function(){ this.select(); });
    input.addEventListener('keyup', (e) => {
      if (e.key >= '0' && e.key <= '9' && index < otpInputs.length - 1){
        otpInputs[index + 1].focus();
      }
      if (e.key === 'Backspace' && index > 0){
        otpInputs[index - 1].focus();
      }
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const digits = (e.clipboardData?.getData('text') || '').replace(/\D+/g, '').slice(0, otpInputs.length).split('');
      digits.forEach((digit, idx) => {
        otpInputs[idx].value = digit;
      });
      if (digits.length) {
        const next = Math.min(digits.length, otpInputs.length - 1);
        otpInputs[next].focus();
      }
    });
  });

  function buildOtp(){
    return otpInputs.map(input => input.value).join('').trim();
  }

  async function submitForm(event){
    event.preventDefault();
    clearAlert();

    const email = document.getElementById('sassLoginId').value.trim();
    const password = passwordInput.value;
    const fullName = document.getElementById('sassFullName').value.trim();
    const phone = document.getElementById('sassPhone').value.trim();
    const twoFactorEnabled = twoFactorToggle.checked;
    const rememberDevice = rememberMe.checked;
    const otp = twoFactorEnabled ? buildOtp() : '';

    if (mode === 'register'){
      if (!fullName || !phone){
        showAlert('error', 'Full name and mobile number are required to register.');
        return;
      }
      if (!document.getElementById('sassTerms').checked){
        showAlert('error', 'Please accept the Electronic Disclosures to continue.');
        return;
      }
    }

    if (mode === 'login' && twoFactorEnabled && otp.length !== 6){
      showAlert('error', 'Enter the 6-digit OTP to continue.');
      return;
    }

    const endpoint = mode === 'login' ? '/api/bank-auth/login' : '/api/bank-auth/register';
    const payload = mode === 'login'
      ? { email, password, otp }
      : { email, password, fullName, phone, twoFactorEnabled, rememberDevice };

    submitButton.disabled = true;
    submitButton.textContent = mode === 'login' ? 'Verifying…' : 'Creating…';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok){
        const message = data?.message || data?.error || 'Unable to process request.';
        throw new Error(message);
      }
      if (mode === 'login' && twoFactorEnabled && !otp){
        otpSection.classList.add('sass-active');
      }
      showAlert('success', mode === 'login' ? 'Login successful. Launching banking experience…' : 'Account created. You can now continue to enrollment.');
    } catch (err){
      showAlert('error', err.message || 'Unexpected error.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = mode === 'login' ? 'Secure Login' : 'Create Account';
    }
  }

  form?.addEventListener('submit', submitForm);
  setMode('login');
})();
