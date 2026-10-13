import { apiGet, apiPost } from '/js/api.js';

// Same password policy as backend
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

const btnSignIn = document.getElementById('btnSignIn');
const btnSignUp = document.getElementById('btnSignUp');
const btnTryDemo = document.getElementById('btnTryDemo');
const btnTryDemo2 = document.getElementById('btnTryDemo2');
const btnHow = document.getElementById('btnHow');
const yearEl = document.getElementById('year');

const modalRoot = document.getElementById('modalRoot');
const modalDialog = document.getElementById('modalDialog');
const modalTitle = document.getElementById('modalTitle');
const modalSub = document.getElementById('modalSub');
const btnCloseModal = document.getElementById('btnCloseModal');

const authForm = document.getElementById('authForm');
const authNameGroup = document.getElementById('authNameGroup');
const authName = document.getElementById('authName');
const authUsername = document.getElementById('authUsername'); // email field
const authPassword = document.getElementById('authPassword');
const authError = document.getElementById('authError');
const authSubmit = document.getElementById('authSubmit');
const authSwitch = document.getElementById('authSwitch');

let loggedIn = false;
let mode = 'signin';
let lastFocus = null;
let inSubmit = false;

function showError(msg) {
  if (!msg) {
    authError.classList.add('hidden');
    authError.textContent = '';
    return;
  }
  authError.classList.remove('hidden');
  authError.textContent = msg;
}

function setMode(nextMode) {
  mode = nextMode;
  if (mode === 'signup') {
    modalTitle.textContent = 'Sign Up';
    modalSub.textContent = 'Create an account to continue.';
    authSubmit.textContent = 'Create account';
    authSwitch.textContent = 'Already have an account? Sign in';
    authPassword.autocomplete = 'new-password';
    if (authNameGroup) authNameGroup.style.display = '';
  } else {
    modalTitle.textContent = 'Sign In';
    modalSub.textContent = 'Use your account to continue.';
    authSubmit.textContent = 'Continue';
    authSwitch.textContent = 'Need an account? Sign up';
    authPassword.autocomplete = 'current-password';
    if (authNameGroup) authNameGroup.style.display = 'none';
  }
  showError('');
}

function getFocusable(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

function onKeydownTrap(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusables = getFocusable(modalDialog);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || active === modalDialog) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function openModal(nextMode) {
  lastFocus = document.activeElement;
  setMode(nextMode);

  modalRoot.classList.remove('hidden');
  modalRoot.setAttribute('aria-hidden', 'false');

  document.addEventListener('keydown', onKeydownTrap, true);

  requestAnimationFrame(() => {
    authUsername.focus();
  });
}

function closeModal() {
  modalRoot.classList.add('hidden');
  modalRoot.setAttribute('aria-hidden', 'true');
  showError('');

  document.removeEventListener('keydown', onKeydownTrap, true);

  if (lastFocus && typeof lastFocus.focus === 'function') {
    lastFocus.focus();
  }
}

async function refreshSession() {
  try {
    await apiGet('/api/auth/me');
    loggedIn = true;
  } catch {
    loggedIn = false;
  }
}

function gotoDashboard() {
  location.assign('/dashboard.html');
}

function tryDemo() {
  if (loggedIn) {
    gotoDashboard();
  } else {
    openModal('signup');
  }
}

function scrollHow() {
  const el = document.getElementById('how');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

modalRoot.addEventListener('click', (e) => {
  if (e.target === modalRoot || e.target?.getAttribute?.('data-close') === 'true') {
    closeModal();
  }
  if (e.target?.classList?.contains('fixed') && e.target?.classList?.contains('inset-0')) {
    if (!modalDialog.contains(e.target)) closeModal();
  }
});

btnCloseModal.addEventListener('click', () => closeModal());
btnSignIn.addEventListener('click', () => openModal('signin'));
btnSignUp.addEventListener('click', () => openModal('signup'));
btnTryDemo.addEventListener('click', () => tryDemo());
btnTryDemo2.addEventListener('click', () => tryDemo());
btnHow.addEventListener('click', () => scrollHow());

authSwitch.addEventListener('click', () => {
  setMode(mode === 'signin' ? 'signup' : 'signin');
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (inSubmit) return;
  inSubmit = true;
  showError('');
  authSubmit.disabled = true;

  try {
    const name = String(authName?.value || '').trim();
    const email = String(authUsername.value || '').trim().toLowerCase();
    const password = String(authPassword.value || '');

    if (mode === 'signup') {
      if (!name) {
        showError('Please enter your name.');
        return;
      }
      if (!email) {
        showError('Please enter your email address.');
        return;
      }
      if (!PASSWORD_RE.test(password)) {
        showError(
          'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
        );
        return;
      }

      await apiPost('/api/auth/signup', { name, email, password });
      showError('Account created. Please sign in.');
      setMode('signin');
      return;
    }

    // Sign in
    if (!email) {
      showError('Please enter your email address.');
      return;
    }
    if (!password) {
      showError('Please enter your password.');
      return;
    }

    const resp = await apiPost('/api/auth/login', { email, password });

    loggedIn = true;
    closeModal();
    // For now both roles go to the same dashboard; admin routing can be added later.
    gotoDashboard();
  } catch (err) {
    const code = err?.message || '';
    if (code === 'name_required') showError('Please enter your name.');
    else if (code === 'email_required') showError('Please enter your email address.');
    else if (code === 'weak_password')
      showError('Password does not meet strength requirements.');
    else if (code === 'email_in_use') showError('An account with this email already exists.');
    else if (code === 'invalid_credentials') showError('Invalid email or password.');
    else showError('Authentication failed. Please try again.');
  } finally {
    authSubmit.disabled = false;
    inSubmit = false;
  }
});

(async function init() {
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
  await refreshSession();
})();
