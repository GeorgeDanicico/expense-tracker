import type { InvestmentApi } from "@/components/investments/investment-api";
import type { NetWorthApi } from "@/components/net-worth/net-worth-api";

import { previewAnswer } from "./expense-fixtures";

// The investment and net-worth writes for `/dev/preview`: each answers after a moment as the server
// would (or is refused with `?failWrites=1`), so the pending order form and the optimistic value, with
// its rollback, can be seen; nothing is kept (a refetch brings the fixtures back).

export const previewInvestmentApi: InvestmentApi = {
  async createOrder() {
    await previewAnswer();
  },
  async removeOrder() {
    await previewAnswer();
  },
};

export const previewNetWorthApi: NetWorthApi = {
  async createItem() {
    await previewAnswer();
  },
  async updateItem() {
    await previewAnswer();
  },
  async addValuation() {
    await previewAnswer();
  },
};
