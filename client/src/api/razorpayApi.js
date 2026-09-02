import api from "./axios";

export const syncPayments = async ({ from, to, actorId }) => {
  const res = await api.post("/razorpay/sync/payments", { from, to, actorId });
  return res.data.data;
};

export const syncSettlements = async ({ year, month, day, actorId }) => {
  const res = await api.post("/razorpay/sync/settlements", { year, month, day, actorId });
  return res.data.data;
};
