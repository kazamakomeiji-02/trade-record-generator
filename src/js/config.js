export const appConfig = Object.freeze({
  storageKey: "trade-record-generator-v2",
  legacyStorageKey: "trade-record-generator-v1",
  rows: Object.freeze([
    Object.freeze({ id: "momentum", label: "动能依据" }),
    Object.freeze({ id: "support", label: "支撑形态" }),
    Object.freeze({ id: "pressure", label: "压力形态" })
  ]),
  cols: Object.freeze([
    Object.freeze({ id: "breakout", label: "形态突破" }),
    Object.freeze({ id: "pullback", label: "回调反弹" })
  ]),
  extraTagRows: Object.freeze([
    Object.freeze({ id: "dynamicStop", label: "动态止损", icon: "动" })
  ]),
  batchFieldIds: Object.freeze([
    "entryPrice",
    "currentPrice",
    "stopPrice",
    "dynamicStopPrice",
    "targetPrice",
    "quantity",
    "entryAmount",
    "dynamicStopEnabled"
  ]),
  batchCount: 3
});
