import api from "./axios";

export const getExceptions = async (params = {}) => {
  const res = await api.get("/exceptions", { params });
  return res.data.data;
};

export const getExceptionSummary = async () => {
  const res = await api.get("/exceptions/summary");
  return res.data.data;
};

export const getException = async (exceptionId) => {
  const res = await api.get(`/exceptions/${exceptionId}`);
  return res.data.data;
};

export const submitHumanDecision = async (exceptionId, { decision, resolutionNotes, actorId }) => {
  const res = await api.patch(`/exceptions/${exceptionId}/decision`, {
    decision,
    resolutionNotes,
    actorId
  });
  return res.data.data;
};

export const investigateException = async (exceptionId, { actorId } = {}) => {
  const res = await api.post(`/exceptions/${exceptionId}/investigate`, { actorId });
  return res.data.data;
};
