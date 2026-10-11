import axios from "axios";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL,
  timeout: 120000,
  headers: {
    "Content-Type": "application/json"
  }
});

// Request interceptor to attach bearer token if present
api.interceptors.request.use(
  (config) => {
    try {
      const token = localStorage.getItem("reconai_token");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Ignore localStorage access failures in restricted environments
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error normalization
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Cleanly handle expired / invalid session
    if (error.response && error.response.status === 401) {
      try {
        localStorage.removeItem("reconai_token");
      } catch {
        // Ignore
      }
    }
    let message = "An unexpected network or server error occurred.";
    let code = "UNKNOWN_ERROR";
    let details = null;

    if (error.response) {
      const data = error.response.data;
      if (data && data.error) {
        message = data.error.message || message;
        code = data.error.code || code;
        details = data.error.details || null;
      } else if (data && data.message) {
        message = data.message;
      }
    } else if (error.request) {
      message = "Unable to reach server. Please ensure backend is running.";
      code = "NETWORK_ERROR";
    }

    const normalizedError = new Error(message);
    normalizedError.code = code;
    normalizedError.details = details;
    normalizedError.originalError = error;

    return Promise.reject(normalizedError);
  }
);

export default api;
