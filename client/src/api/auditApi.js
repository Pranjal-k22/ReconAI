import api from "./axios";

export const getAuditEvents = async (params = {}) => {
  const res = await api.get("/audit", { params });
  return res.data.data;
};

export const getAuditEvent = async (eventId) => {
  const res = await api.get(`/audit/${eventId}`);
  return res.data.data;
};
