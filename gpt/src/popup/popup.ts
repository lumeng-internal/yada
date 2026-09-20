import { loadQuotaPopup } from "./app";

const app = document.getElementById("app");
if (!app) throw new Error("popup root missing");

void loadQuotaPopup(app);
