export interface DeliveryJob {
  deliveryId: string;
}

export interface WebhookOutboundPayload {
  id: string;
  type: string;
  createdAt: string;
  data: unknown;
}
