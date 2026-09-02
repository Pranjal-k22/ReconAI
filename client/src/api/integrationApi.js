import api from "./axios";

export const getIntegrationStatus = async () => {
  const res = await api.get("/integrations/status");
  return res.data.data;
};
