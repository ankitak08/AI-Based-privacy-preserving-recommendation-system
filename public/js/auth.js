import { apiGet, apiPost } from '/js/api.js';

function show(el, msg) {
  el.style.display = 'block';
  el.textContent = msg;
}

async function ensureLoggedOutRedirect() {
  try {
    await apiGet('/api/auth/me');
    location.replace('/dashboard.html');
  } catch {
  }
}

ensureLoggedOutRedirect();

const loginEmail = document.getElementById('loginEmail');
const loginPass = document.getElementById('loginPass');
const loginBtn = document.getElementById('loginBtn');
const loginMsg = document.getElementById('loginMsg');

loginBtn.addEventListener('click', async () => {
  loginMsg.style.display = 'none';
  try {
    await apiPost('/api/auth/login', { email: loginEmail.value.trim(), password: loginPass.value });
    location.replace('/dashboard.html');
  } catch (e) {
    show(loginMsg, `Login failed: ${e.message}`);
  }
});

const signupName = document.getElementById('signupName');
const signupEmail = document.getElementById('signupEmail');
const signupPass = document.getElementById('signupPass');
const signupBtn = document.getElementById('signupBtn');
const signupMsg = document.getElementById('signupMsg');

signupBtn.addEventListener('click', async () => {
  signupMsg.style.display = 'none';
  try {
    await apiPost('/api/auth/signup', { 
      name: signupName.value.trim(), 
      email: signupEmail.value.trim(), 
      password: signupPass.value 
    });
    show(signupMsg, 'Account created! Please login.');
    signupName.value = '';
    signupEmail.value = '';
    signupPass.value = '';
  } catch (e) {
    show(signupMsg, `Signup failed: ${e.message}`);
  }
});
