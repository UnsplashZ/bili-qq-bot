import axios from 'axios';

// Create a standalone axios instance
const api = axios.create({
  // If you have a specific base URL, set it here.
  // Otherwise, it defaults to the current origin (which works with Vite proxy)
  baseURL: '/',
});

// Request interceptor to add the token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('token');
      // Using window.location to ensure state is cleared
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const getToken = () => localStorage.getItem('token');

export const login = async (password) => {
  // Call the login API
  const response = await api.post('/api/login', { password });
  const { token } = response.data;
  if (token) {
    localStorage.setItem('token', token);
  }
  return response.data;
};

export const logout = () => {
  localStorage.removeItem('token');
  window.location.href = '/login';
};

export default api;
