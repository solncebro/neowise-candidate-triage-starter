import { createApp } from "./app.mjs";

createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
