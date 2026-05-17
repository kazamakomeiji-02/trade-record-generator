import { appConfig } from "./config.js";

(function (config) {
      "use strict";

      var storageKey = config.storageKey;
      var legacyStorageKey = config.legacyStorageKey;
      var rows = config.rows;
      var cols = config.cols;
      var extraTagRows = config.extraTagRows;
      var tagRows = rows.concat(extraTagRows);
      var batchFieldIds = config.batchFieldIds;
      var batchCount = config.batchCount;
      var state = {
        currentId: null,
        records: [],
        currentTrialId: null,
        trialRecords: [],
        signalRecords: [],
        currentSignalId: null,
        tagLibrary: createEmptyTagLibrary(),
        showArchived: false,
        riskSettings: createDefaultRiskSettings(),
        accountSettings: createDefaultAccountSettings()
      };

      var els = {};
      var pendingArchiveId = null;
      var pendingSignalBuildId = null;
      var signalTrialCollapsed = false;
      var undoStack = [];
      var redoStack = [];
      var isRestoringHistory = false;

      function $(id) {
        return document.getElementById(id);
      }

      function numberValue(id) {
        var value = parseFloat($(id).value);
        return Number.isFinite(value) ? value : 0;
      }

      function createDefaultRiskSettings() {
        return {
          singleLossLimit: "",
          globalLossLimit: ""
        };
      }

      function createDefaultAccountSettings() {
        return {
          totalAssets: ""
        };
      }

      function money(value) {
        return value.toLocaleString("zh-CN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }) + " 元";
      }

      function signedPercent(value) {
        if (!Number.isFinite(value)) return "0%";
        var sign = value > 0 ? "+" : "";
        return sign + (value * 100).toFixed(2).replace(/\.?0+$/, "") + "%";
      }

      function realRatioText(profitRate, lossRate) {
        var adjustedProfit = Math.max(0, Math.abs(profitRate) - 0.01);
        var adjustedLoss = Math.abs(lossRate) + 0.01;
        var ratio = adjustedLoss > 0 ? adjustedProfit / adjustedLoss : 0;
        return "真实 " + ratio.toFixed(2) + " : 1";
      }

      function signedFixed(value) {
        var sign = value > 0 ? "+" : "";
        return sign + value.toFixed(4);
      }

      function normalizeRiskSettings(settings) {
        var defaults = createDefaultRiskSettings();
        if (!settings || typeof settings !== "object") return defaults;
        return {
          singleLossLimit: settings.singleLossLimit !== undefined ? String(settings.singleLossLimit) : defaults.singleLossLimit,
          globalLossLimit: settings.globalLossLimit !== undefined ? String(settings.globalLossLimit) : defaults.globalLossLimit
        };
      }

      function normalizeAccountSettings(settings) {
        var defaults = createDefaultAccountSettings();
        if (!settings || typeof settings !== "object") return defaults;
        return {
          totalAssets: settings.totalAssets !== undefined ? String(settings.totalAssets) : defaults.totalAssets
        };
      }

      function showToast(message) {
        els.toast.textContent = message;
        els.toast.classList.add("is-open");
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(function () {
          els.toast.classList.remove("is-open");
        }, 1600);
      }

      function getCellKey(rowId, colId) {
        return rowId + "__" + colId;
      }

      function createEmptyTagLibrary() {
        return tagRows.reduce(function (library, row) {
          library[row.id] = [];
          return library;
        }, {});
      }

      function nowInputValue() {
        var now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        return now.toISOString().slice(0, 16);
      }

      function createDefaultBatch(source, emptySize) {
        source = source || {};
        return {
          entryPrice: source.entryPrice !== undefined ? String(source.entryPrice) : "10",
          currentPrice: source.currentPrice !== undefined ? String(source.currentPrice) : "10",
          stopPrice: source.stopPrice !== undefined ? String(source.stopPrice) : "9",
          dynamicStopPrice: source.dynamicStopPrice !== undefined ? String(source.dynamicStopPrice) : "10",
          targetPrice: source.targetPrice !== undefined ? String(source.targetPrice) : "12.5",
          quantity: emptySize ? "0" : (source.quantity !== undefined ? String(source.quantity) : "100"),
          entryAmount: emptySize ? "0" : (source.entryAmount !== undefined ? String(source.entryAmount) : "1000"),
          dynamicStopEnabled: source.dynamicStopEnabled !== undefined ? String(source.dynamicStopEnabled) : "0"
        };
      }

      function createDefaultFields() {
        var batch = createDefaultBatch();
        return {
          symbol: "",
          riskMarkEnabled: "0",
          riskNote: "",
          stockCode: "",
          buyTime: nowInputValue().slice(0, 10),
          timeStopEnabled: "1",
          timeStopDays: "7",
          dynamicStopEnabled: "0",
          entryPrice: batch.entryPrice,
          currentPrice: batch.currentPrice,
          stopPrice: batch.stopPrice,
          dynamicStopPrice: batch.dynamicStopPrice,
          targetPrice: batch.targetPrice,
          quantity: batch.quantity,
          entryAmount: batch.entryAmount
        };
      }

      function createRecord(fields, cells) {
        var id = "record-" + Date.now() + "-" + Math.random().toString(16).slice(2);
        var normalizedFields = fields || createDefaultFields();
        return {
          id: id,
          fields: normalizedFields,
          cells: cells || {},
          currentBatchIndex: 0,
          batches: [
            createDefaultBatch(normalizedFields),
            createDefaultBatch(normalizedFields, true),
            createDefaultBatch(normalizedFields, true)
          ],
          dynamicStopTags: [],
          archived: false,
          archiveInfo: null,
          selectedLogic: "breakout",
          updatedAt: new Date().toISOString()
        };
      }

      function createTrialRecord(values) {
        var id = "trial-" + Date.now() + "-" + Math.random().toString(16).slice(2);
        var data = values || {};
        return {
          id: id,
          name: String(data.name || ""),
          code: String(data.code || ""),
          entry: String(data.entry || "10"),
          quantity: String(data.quantity || ""),
          firstSupport: String(data.firstSupport || data.stop || "9"),
          secondSupport: String(data.secondSupport || data.firstSupport || data.stop || "9"),
          pressure: String(data.pressure || data.target || "12.5"),
          maxLoss: String(data.maxLoss || ""),
          selectedLogic: String(data.selectedLogic || "breakout"),
          cells: data.cells && typeof data.cells === "object" ? data.cells : {},
          trendShapeLow: String(data.trendShapeLow || ""),
          trendNeckline: String(data.trendNeckline || ""),
          trendStart: String(data.trendStart || ""),
          trendWaveLow: String(data.trendWaveLow || ""),
          trendWaveHigh: String(data.trendWaveHigh || ""),
          updatedAt: new Date().toISOString()
        };
      }

      function createSignalRecord(values) {
        var id = "signal-" + Date.now() + "-" + Math.random().toString(16).slice(2);
        var data = values || {};
        var conditions = Array.isArray(data.conditions) ? data.conditions.map(function (item) {
          return {
            label: String(item.label || ""),
            value: String(item.value || "")
          };
        }).filter(function (item) { return item.label || item.value; }) : [];
        var createdAt = data.createdAt ? String(data.createdAt) : new Date().toISOString();
        var trial = normalizeSignalTrialData(data.trial || data.target || data, conditions);
        var signal = normalizeSignalMetaData(data.signal || data, trial, conditions, createdAt);
        return {
          id: data.id ? String(data.id) : id,
          sourceTrialId: String(data.sourceTrialId || ""),
          name: String(data.name || trial.name || "未命名目标"),
          code: String(data.code || trial.code || ""),
          createdAt: createdAt,
          updatedAt: data.updatedAt ? String(data.updatedAt) : new Date().toISOString(),
          trial: trial,
          signal: signal,
          conditions: conditions,
          status: data.status ? String(data.status) : "pending",
          note: data.note ? String(data.note) : "",
          triggeredAt: data.triggeredAt ? String(data.triggeredAt) : "",
          triggeredEntry: data.triggeredEntry !== undefined ? String(data.triggeredEntry) : "",
          triggeredPosition: data.triggeredPosition !== undefined ? String(data.triggeredPosition) : ""
        };
      }

      function firstSignalCondition(conditions, names) {
        if (!Array.isArray(conditions)) return "";
        for (var i = 0; i < conditions.length; i += 1) {
          var label = String(conditions[i].label || "");
          for (var j = 0; j < names.length; j += 1) {
            if (label === names[j] || label.indexOf(names[j]) !== -1) return String(conditions[i].value || "");
          }
        }
        return "";
      }

      function signalNumberText(value) {
        var match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
        return match ? match[0] : "";
      }

      function normalizeSignalTrialData(data, conditions) {
        data = data || {};
        return {
          name: String(data.name || ""),
          code: String(data.code || ""),
          entry: String(data.entry || signalNumberText(firstSignalCondition(conditions, ["入场价", "入场价格"])) || "0"),
          quantity: String(data.quantity || signalNumberText(firstSignalCondition(conditions, ["持仓数量"])) || ""),
          firstSupport: String(data.firstSupport || data.stop || signalNumberText(firstSignalCondition(conditions, ["第一支撑", "支撑1"])) || "0"),
          secondSupport: String(data.secondSupport || data.firstSupport || data.stop || signalNumberText(firstSignalCondition(conditions, ["第二支撑", "支撑2"])) || "0"),
          pressure: String(data.pressure || data.target || signalNumberText(firstSignalCondition(conditions, ["压力位", "目标价", "目标价格"])) || "0"),
          maxLoss: String(data.maxLoss || signalNumberText(firstSignalCondition(conditions, ["最大亏损"])) || ""),
          ratioFirst: String(data.ratioFirst || firstSignalCondition(conditions, ["第一盈亏比"]) || ""),
          ratioSecond: String(data.ratioSecond || firstSignalCondition(conditions, ["第二盈亏比"]) || ""),
          profitRate: String(data.profitRate || firstSignalCondition(conditions, ["盈利空间"]) || ""),
          supportRate: String(data.supportRate || firstSignalCondition(conditions, ["支撑空间"]) || ""),
          trendShapePressure: String(data.trendShapePressure || firstSignalCondition(conditions, ["形态压力"]) || "-"),
          trendMapPressure: String(data.trendMapPressure || firstSignalCondition(conditions, ["映射压力"]) || "-"),
          trendGoldenPressure: String(data.trendGoldenPressure || firstSignalCondition(conditions, ["黄金比压力"]) || "-"),
          selectedLogic: String(data.selectedLogic || firstSignalCondition(conditions, ["逻辑"]) || "breakout"),
          cells: normalizeTrialCells(data.cells)
        };
      }

      function normalizeSignalMetaData(data, trial, conditions, createdAt) {
        data = data || {};
        var expireDays = data.expiresTradingDays !== undefined ? String(data.expiresTradingDays) : (data.expireDays !== undefined ? String(data.expireDays) : "5");
        return {
          entryPrice1: String(data.entryPrice1 || data.entryRangeFirst || signalNumberText(firstSignalCondition(conditions, ["入场价格1", "入场范围1"])) || ""),
          entryPrice2: String(data.entryPrice2 || data.entryRangeSecond || signalNumberText(firstSignalCondition(conditions, ["入场价格2", "入场范围2"])) || ""),
          maxPositionFirst: data.maxPositionFirst !== undefined ? String(data.maxPositionFirst) : "",
          maxPositionSecond: data.maxPositionSecond !== undefined ? String(data.maxPositionSecond) : "",
          expiresTradingDays: expireDays,
          expiresOn: data.expiresOn ? String(data.expiresOn) : signalExpiryDate(createdAt, expireDays)
        };
      }
      function isBatchField(id) {
        return batchFieldIds.indexOf(id) !== -1;
      }

      function normalizeBatch(batch, fallback, emptySize) {
        var source = Object.assign({}, fallback || {}, batch || {});
        return createDefaultBatch(source, emptySize);
      }

      function normalizeRecordBatches(record) {
        if (!record.fields) record.fields = createDefaultFields();
        var baseBatch = createDefaultBatch(record.fields);
        var sourceBatches = Array.isArray(record.batches) ? record.batches : [baseBatch];
        record.batches = [];
        for (var index = 0; index < batchCount; index += 1) {
          record.batches.push(normalizeBatch(sourceBatches[index], baseBatch, index > 0 && !sourceBatches[index]));
        }
        var currentIndex = parseInt(record.currentBatchIndex, 10);
        record.currentBatchIndex = Number.isFinite(currentIndex) && currentIndex >= 0 && currentIndex < batchCount ? currentIndex : 0;
        syncActiveBatchToFields(record);
        return record;
      }

      function activeBatch(record) {
        record = normalizeRecordBatches(record || activeRecord());
        return record.batches[record.currentBatchIndex || 0];
      }

      function syncActiveBatchToFields(record) {
        if (!record || !record.fields || !Array.isArray(record.batches)) return;
        var batch = record.batches[record.currentBatchIndex || 0] || record.batches[0];
        batchFieldIds.forEach(function (id) {
          record.fields[id] = batch[id] !== undefined ? String(batch[id]) : createDefaultBatch()[id];
        });
      }

      function syncVisibleFieldsToRecord(record) {
        record = normalizeRecordBatches(record || activeRecord());
        var batch = activeBatch(record);
        document.querySelectorAll("[data-save]").forEach(function (input) {
          if (isBatchField(input.id)) {
            batch[input.id] = input.value;
          } else {
            record.fields[input.id] = input.value;
          }
        });
        if ($("dynamicStopToggle")) {
          batch.dynamicStopEnabled = $("dynamicStopToggle").getAttribute("aria-pressed") === "true" ? "1" : "0";
        }
        syncActiveBatchToFields(record);
        return record;
      }

      function batchNumber(batch, id) {
        var value = parseFloat(batch && batch[id]);
        return Number.isFinite(value) ? value : 0;
      }

      function activeRecord() {
        var record = state.records.find(function (item) {
          return item.id === state.currentId;
        });
        if (!record) {
          record = createRecord();
          state.records.unshift(record);
          state.currentId = record.id;
        }
        if (!record.fields) record.fields = createDefaultFields();
        record.fields = Object.assign(createDefaultFields(), record.fields);
        normalizeRecordBatches(record);
        if (!record.cells) record.cells = {};
        if (!Array.isArray(record.dynamicStopTags)) record.dynamicStopTags = [];
        record.archived = record.archived === true;
        if (record.archiveInfo && typeof record.archiveInfo !== "object") record.archiveInfo = null;
        if (!record.selectedLogic) record.selectedLogic = "breakout";
        return record;
      }

      function ensureCell(key) {
        var record = activeRecord();
        if (!record.cells[key]) {
          record.cells[key] = { tags: [] };
        }
        return record.cells[key];
      }

      function normalizeTagLibrary(library) {
        var normalized = createEmptyTagLibrary();
        if (Array.isArray(library)) return normalized;
        tagRows.forEach(function (row) {
          if (library && Array.isArray(library[row.id])) {
            normalized[row.id] = library[row.id].filter(Boolean);
          }
        });
        return normalized;
      }

      function normalizeTrialRecord(record, index) {
        var normalized = createTrialRecord();
        normalized.id = record && record.id ? String(record.id) : "trial-imported-" + Date.now() + "-" + index;
        normalized.name = String(record && record.name || "");
        normalized.code = String(record && record.code || "");
        normalized.entry = String(record && record.entry || "10");
        normalized.quantity = String(record && record.quantity || "");
        normalized.firstSupport = String(record && (record.firstSupport || record.stop) || "9");
        normalized.secondSupport = String(record && (record.secondSupport || record.firstSupport || record.stop) || "9");
        normalized.pressure = String(record && (record.pressure || record.target) || "12.5");
        normalized.maxLoss = String(record && record.maxLoss || "");
        normalized.selectedLogic = String(record && record.selectedLogic || "breakout");
        normalized.cells = normalizeTrialCells(record && record.cells);
        normalized.trendShapeLow = String(record && record.trendShapeLow || "");
        normalized.trendNeckline = String(record && record.trendNeckline || "");
        normalized.trendStart = String(record && record.trendStart || "");
        normalized.trendWaveLow = String(record && record.trendWaveLow || "");
        normalized.trendWaveHigh = String(record && record.trendWaveHigh || "");
        normalized.updatedAt = record && record.updatedAt ? String(record.updatedAt) : new Date().toISOString();
        return normalized;
      }

      function normalizeTrialCells(cells) {
        var normalized = {};
        if (!cells || typeof cells !== "object") return normalized;
        Object.keys(cells).forEach(function (key) {
          var source = cells[key] || {};
          normalized[key] = {
            tags: Array.isArray(source.tags) ? source.tags.map(String).filter(Boolean) : []
          };
        });
        return normalized;
      }

      function normalizeSignalRecord(record, index) {
        return createSignalRecord({
          id: record && record.id ? String(record.id) : "signal-imported-" + Date.now() + "-" + index,
          sourceTrialId: record && record.sourceTrialId ? String(record.sourceTrialId) : "",
          name: record && record.name ? String(record.name) : "未命名目标",
          code: record && record.code ? String(record.code) : "",
          createdAt: record && record.createdAt ? String(record.createdAt) : "",
          updatedAt: record && record.updatedAt ? String(record.updatedAt) : "",
          trial: record && record.trial && typeof record.trial === "object" ? record.trial : record,
          signal: record && record.signal && typeof record.signal === "object" ? record.signal : record,
          conditions: Array.isArray(record && record.conditions) ? record.conditions : [],
          status: record && record.status ? String(record.status) : "pending",
          note: record && record.note ? String(record.note) : "",
          triggeredAt: record && record.triggeredAt ? String(record.triggeredAt) : "",
          triggeredEntry: record && record.triggeredEntry !== undefined ? String(record.triggeredEntry) : "",
          triggeredPosition: record && record.triggeredPosition !== undefined ? String(record.triggeredPosition) : ""
        });
      }
      function readStorage() {
        try {
          var saved = JSON.parse(localStorage.getItem(storageKey) || "null");
          if (saved && Array.isArray(saved.records)) {
            state.currentId = saved.currentId || null;
            state.records = saved.records.length ? saved.records.map(normalizeImportedRecord) : [createRecord()];
            state.currentTrialId = saved.currentTrialId || null;
            state.trialRecords = Array.isArray(saved.trialRecords) ? saved.trialRecords.map(normalizeTrialRecord) : [];
            state.signalRecords = Array.isArray(saved.signalRecords) ? saved.signalRecords.map(normalizeSignalRecord) : [];
            state.currentSignalId = saved.currentSignalId || null;
            state.tagLibrary = normalizeTagLibrary(saved.tagLibrary);
            state.showArchived = saved.showArchived === true;
            state.riskSettings = normalizeRiskSettings(saved.riskSettings);
            state.accountSettings = normalizeAccountSettings(saved.accountSettings);
          } else {
            var legacy = JSON.parse(localStorage.getItem(legacyStorageKey) || "null");
            if (legacy) {
              state.records = [createRecord(legacy.fields || createDefaultFields(), legacy.cells || {})];
              state.currentId = state.records[0].id;
              state.currentTrialId = null;
              state.trialRecords = [];
              state.signalRecords = [];
              state.currentSignalId = null;
              state.tagLibrary = createEmptyTagLibrary();
              state.showArchived = false;
              state.riskSettings = createDefaultRiskSettings();
              state.accountSettings = createDefaultAccountSettings();
            }
          }
        } catch (error) {
          state = {
            currentId: null,
            records: [],
            currentTrialId: null,
            trialRecords: [],
            signalRecords: [],
            currentSignalId: null,
            tagLibrary: createEmptyTagLibrary(),
            showArchived: false,
            riskSettings: createDefaultRiskSettings(),
            accountSettings: createDefaultAccountSettings()
          };
        }
        state.riskSettings = normalizeRiskSettings(state.riskSettings);
        state.accountSettings = normalizeAccountSettings(state.accountSettings);
        if (!Array.isArray(state.trialRecords)) state.trialRecords = [];
        if (!Array.isArray(state.signalRecords)) state.signalRecords = [];
        pruneExpiredSignals(false);
        if (state.currentTrialId && !state.trialRecords.some(function (record) { return record.id === state.currentTrialId; })) {
          state.currentTrialId = null;
        }
        if (state.currentSignalId && !state.signalRecords.some(function (record) { return record.id === state.currentSignalId; })) {
          state.currentSignalId = null;
        }
        if (!state.currentSignalId && state.signalRecords.length) state.currentSignalId = state.signalRecords[0].id;
        activeRecord();
      }

      function makeSnapshot() {
        writeStorage(true);
        return JSON.stringify({
          state: state,
          currentId: state.currentId
        });
      }

      function pushUndoSnapshot() {
        if (isRestoringHistory) return;
        undoStack.push(makeSnapshot());
        if (undoStack.length > 60) undoStack.shift();
        redoStack = [];
      }

      function restoreSnapshot(snapshot) {
        if (!snapshot) return;
        isRestoringHistory = true;
        var parsed = JSON.parse(snapshot);
        state = parsed.state;
        localStorage.setItem(storageKey, JSON.stringify(state));
        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        recalc();
        renderRecords();
        renderTagManager();
        renderSignalRecords();
        renderHomeAccount();
        updateLogicView();
        isRestoringHistory = false;
      }

      function undoChange() {
        if (!undoStack.length) return;
        redoStack.push(makeSnapshot());
        restoreSnapshot(undoStack.pop());
      }

      function redoChange() {
        if (!redoStack.length) return;
        undoStack.push(makeSnapshot());
        restoreSnapshot(redoStack.pop());
      }

      function writeStorage(silent) {
        var record = activeRecord();
        syncVisibleFieldsToRecord(record);
        document.querySelectorAll("[data-account-save]").forEach(function (input) {
          if (!state.accountSettings) state.accountSettings = createDefaultAccountSettings();
          state.accountSettings[input.dataset.accountSave] = input.value;
        });
        document.querySelectorAll("[data-risk-save]").forEach(function (input) {
          state.riskSettings[input.id] = input.value;
        });
        record.fields.timeStopEnabled = $("timeStopToggle").getAttribute("aria-pressed") === "true" ? "1" : "0";
        activeBatch(record).dynamicStopEnabled = $("dynamicStopToggle").getAttribute("aria-pressed") === "true" ? "1" : "0";
        syncActiveBatchToFields(record);
        record.fields.riskMarkEnabled = $("riskMarkToggle").getAttribute("aria-pressed") === "true" ? "1" : "0";
        record.updatedAt = new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderRecords();
        renderHomeAccount();
        if (!silent) showToast("已保存到本机");
      }

      function normalizeImportedRecord(record, index) {
        var normalized = createRecord();
        var fields = record && record.fields && typeof record.fields === "object" ? record.fields : {};
        normalized.id = record && record.id ? String(record.id) : "imported-" + Date.now() + "-" + index;
        normalized.fields = Object.assign(createDefaultFields(), fields);
        normalized.currentBatchIndex = record && record.currentBatchIndex !== undefined ? parseInt(record.currentBatchIndex, 10) || 0 : 0;
        normalized.batches = Array.isArray(record && record.batches)
          ? record.batches.slice(0, batchCount).map(function (batch, batchIndex) {
            return normalizeBatch(batch, normalized.fields, batchIndex > 0 && !batch);
          })
          : [createDefaultBatch(normalized.fields)];
        while (normalized.batches.length < batchCount) {
          normalized.batches.push(createDefaultBatch(normalized.fields, true));
        }
        normalizeRecordBatches(normalized);
        normalized.cells = {};
        normalized.dynamicStopTags = Array.isArray(record && record.dynamicStopTags)
          ? record.dynamicStopTags.filter(Boolean).map(String)
          : [];
        normalized.archived = record && record.archived === true;
        normalized.archiveInfo = record && record.archiveInfo && typeof record.archiveInfo === "object" ? {
          result: record.archiveInfo.result === "loss" ? "loss" : "win",
          sellPrice: String(record.archiveInfo.sellPrice || ""),
          archivedAt: record.archiveInfo.archivedAt ? String(record.archiveInfo.archivedAt) : "",
          profitText: record.archiveInfo.profitText ? String(record.archiveInfo.profitText) : "",
          entryJudgement: record.archiveInfo.entryJudgement ? String(record.archiveInfo.entryJudgement) : "",
          marketTruth: record.archiveInfo.marketTruth ? String(record.archiveInfo.marketTruth) : ""
        } : null;
        if (normalized.archiveInfo && normalized.archiveInfo.sellPrice) {
          normalized.archiveInfo.profitText = archivePnlText(normalized, normalized.archiveInfo.sellPrice);
          normalized.archiveInfo.result = recordArchivePnl(normalized, normalized.archiveInfo.sellPrice) < 0 ? "loss" : "win";
        }
        normalized.selectedLogic = record && record.selectedLogic === "pullback" ? "pullback" : "breakout";
        normalized.updatedAt = record && record.updatedAt ? String(record.updatedAt) : new Date().toISOString();

        if (record && record.cells && typeof record.cells === "object") {
          Object.keys(record.cells).forEach(function (key) {
            var cell = record.cells[key];
            normalized.cells[key] = {
              tags: cell && Array.isArray(cell.tags) ? cell.tags.filter(Boolean).map(String) : []
            };
          });
        }
        return normalized;
      }

      function normalizeBackupPayload(payload) {
        var source = payload && payload.state ? payload.state : payload;
        if (!source || !Array.isArray(source.records)) {
          throw new Error("Invalid backup");
        }
        var importedRecords = source.records.map(normalizeImportedRecord);
        var importedTrials = Array.isArray(source.trialRecords) ? source.trialRecords.map(normalizeTrialRecord) : [];
        var importedSignals = Array.isArray(source.signalRecords) ? source.signalRecords.map(normalizeSignalRecord) : [];
        if (!importedRecords.length) importedRecords = [createRecord()];
        return {
          currentId: source.currentId && importedRecords.some(function (record) {
            return record.id === source.currentId;
          }) ? source.currentId : importedRecords[0].id,
          records: importedRecords,
          currentTrialId: source.currentTrialId && importedTrials.some(function (record) {
            return record.id === source.currentTrialId;
          }) ? source.currentTrialId : null,
          trialRecords: importedTrials,
          currentSignalId: source.currentSignalId && importedSignals.some(function (record) {
            return record.id === source.currentSignalId;
          }) ? source.currentSignalId : (importedSignals[0] ? importedSignals[0].id : null),
          signalRecords: importedSignals,
          tagLibrary: normalizeTagLibrary(source.tagLibrary),
          showArchived: source.showArchived === true,
          riskSettings: normalizeRiskSettings(source.riskSettings),
          accountSettings: normalizeAccountSettings(source.accountSettings)
        };
      }

      function refreshAfterBackupImport() {
        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        recalc();
        renderRecords();
        renderTagManager();
        renderSignalRecords();
        renderHomeAccount();
        updateLogicView();
      }

      function exportRecords() {
        writeStorage(true);
        var backup = {
          app: "trade-record-pwa",
          version: 5,
          exportedAt: new Date().toISOString(),
          state: {
            currentId: state.currentId,
            records: state.records,
            currentTrialId: state.currentTrialId,
            trialRecords: state.trialRecords,
            currentSignalId: state.currentSignalId,
            signalRecords: state.signalRecords || [],
            tagLibrary: state.tagLibrary,
            showArchived: state.showArchived,
            riskSettings: state.riskSettings,
            accountSettings: state.accountSettings
          }
        };
        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        var date = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = "trade-record-backup-" + date + ".json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
        showToast("\u5df2\u5bfc\u51faJSON\u5907\u4efd");
      }

      function importRecordsFile(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var nextState = normalizeBackupPayload(JSON.parse(String(reader.result || "")));
            if (!window.confirm("\u5bfc\u5165\u4f1a\u66ff\u6362\u5f53\u524d\u5168\u90e8\u4fdd\u5b58\u8bb0\u5f55\uff0c\u786e\u8ba4\u7ee7\u7eed\uff1f")) return;
            state = nextState;
            localStorage.setItem(storageKey, JSON.stringify(state));
            refreshAfterBackupImport();
            showToast("\u5df2\u5bfc\u5165\u5907\u4efd");
          } catch (error) {
            showToast("\u5bfc\u5165\u5931\u8d25\uff1aJSON\u683c\u5f0f\u4e0d\u6b63\u786e");
          }
        };
        reader.readAsText(file);
      }

      function cleanTableCell(value) {
        return String(value || "")
          .replace(/^\ufeff/, "")
          .replace(/^="?/, "")
          .replace(/"?$/, "")
          .trim();
      }

      function normalizeStockCode(value) {
        var text = cleanTableCell(value);
        var groups = text.match(/\d+/g);
        var digits = groups ? (groups.find(function (group) { return group.length >= 6; }) || groups[0]) : "";
        if (!digits) return text.toUpperCase();
        return digits.length < 6 ? digits.padStart(6, "0") : digits.slice(-6);
      }

      function splitDelimitedLine(line, delimiter) {
        if (delimiter !== ",") return line.split(delimiter).map(cleanTableCell);
        var cells = [];
        var current = "";
        var quoted = false;
        for (var i = 0; i < line.length; i += 1) {
          var ch = line.charAt(i);
          if (ch === '"') {
            if (quoted && line.charAt(i + 1) === '"') {
              current += '"';
              i += 1;
            } else {
              quoted = !quoted;
            }
          } else if (ch === "," && !quoted) {
            cells.push(cleanTableCell(current));
            current = "";
          } else {
            current += ch;
          }
        }
        cells.push(cleanTableCell(current));
        return cells;
      }

      function findHeaderIndex(headers, names) {
        var normalizedNames = names.map(function (name) {
          return name.replace(/\s/g, "");
        });
        for (var i = 0; i < headers.length; i += 1) {
          var header = cleanTableCell(headers[i]).replace(/\s/g, "");
          if (normalizedNames.indexOf(header) !== -1) return i;
        }
        for (var j = 0; j < headers.length; j += 1) {
          var looseHeader = cleanTableCell(headers[j]).replace(/\s/g, "");
          if (normalizedNames.some(function (name) { return looseHeader.indexOf(name) !== -1; })) return j;
        }
        return -1;
      }

      function parsePriceTable(text) {
        var lines = String(text || "").replace(/\r/g, "\n").split("\n").filter(function (line) {
          return line.trim();
        });
        if (!lines.length) throw new Error("empty");
        var headerLine = lines[0];
        var delimiters = ["\t", ",", ";"];
        var delimiter = delimiters.reduce(function (best, item) {
          return headerLine.split(item).length > headerLine.split(best).length ? item : best;
        }, "\t");
        var headers = splitDelimitedLine(headerLine, delimiter);
        var codeIndex = findHeaderIndex(headers, ["证券代码", "股票代码", "代码"]);
        var priceIndex = findHeaderIndex(headers, ["市价", "当前价", "最新价"]);
        var nameIndex = findHeaderIndex(headers, ["证券名称", "股票名称", "名称"]);
        if (codeIndex === -1 || priceIndex === -1) throw new Error("columns");
        return lines.slice(1).map(function (line) {
          var cells = splitDelimitedLine(line, delimiter);
          return {
            code: normalizeStockCode(cells[codeIndex]),
            name: nameIndex === -1 ? "" : cleanTableCell(cells[nameIndex]),
            price: cleanTableCell(cells[priceIndex])
          };
        }).filter(function (row) {
          return row.code && row.price && Number.isFinite(parseFloat(row.price.replace(/,/g, "")));
        });
      }

      function numberCell(value) {
        return cleanTableCell(value).replace(/,/g, "");
      }

      function parseSupportPressureTable(text) {
        var lines = String(text || "").replace(/\r/g, "\n").split("\n").filter(function (line) {
          return line.trim();
        });
        if (!lines.length) throw new Error("empty");
        var headerLine = lines[0];
        var delimiters = ["\t", ",", ";"];
        var delimiter = delimiters.reduce(function (best, item) {
          return headerLine.split(item).length > headerLine.split(best).length ? item : best;
        }, "\t");
        var headers = splitDelimitedLine(headerLine, delimiter);
        var codeIndex = findHeaderIndex(headers, ["代码", "证券代码", "股票代码"]);
        var nameIndex = findHeaderIndex(headers, ["名称", "证券名称", "股票名称"]);
        var entryIndex = findHeaderIndex(headers, ["现价", "当前价格", "当前价", "市价"]);
        var pressureIndex = findHeaderIndex(headers, ["压力", "压力位"]);
        var firstSupportIndex = findHeaderIndex(headers, ["第一支撑", "支撑1", "一支撑"]);
        var secondSupportIndex = findHeaderIndex(headers, ["第二支撑", "支撑2", "二支撑"]);
        if (codeIndex === -1 || nameIndex === -1 || entryIndex === -1 || pressureIndex === -1 || firstSupportIndex === -1 || secondSupportIndex === -1) {
          throw new Error("columns");
        }
        return lines.slice(1).map(function (line, index) {
          var cells = splitDelimitedLine(line, delimiter);
          var name = cleanTableCell(cells[nameIndex]);
          var code = cleanTableCell(cells[codeIndex]);
          var entry = numberCell(cells[entryIndex]);
          var pressure = numberCell(cells[pressureIndex]);
          var firstSupport = numberCell(cells[firstSupportIndex]);
          var secondSupport = numberCell(cells[secondSupportIndex]);
          if (!code || !entry || !pressure || !firstSupport || !secondSupport) return null;
          if (![entry, pressure, firstSupport, secondSupport].every(function (value) { return Number.isFinite(parseFloat(value)); })) return null;
          return createTrialRecord({
            name: (name || code || ("导入目标" + (index + 1))) + " 目标",
            code: code,
            entry: entry,
            firstSupport: firstSupport,
            secondSupport: secondSupport,
            pressure: pressure
          });
        }).filter(Boolean);
      }

      function decodePriceTableBuffer(buffer) {
        var bytes = new Uint8Array(buffer);
        var utfText = "";
        try {
          var gbText = new TextDecoder("gb18030").decode(bytes);
          if (gbText.indexOf("证券代码") !== -1 || gbText.indexOf("股票代码") !== -1 || gbText.indexOf("代码") !== -1 || gbText.indexOf("市价") !== -1 || gbText.indexOf("现价") !== -1 || gbText.indexOf("压力") !== -1 || gbText.indexOf("第一支撑") !== -1) return gbText;
        } catch (error) {
          // Fall through to UTF-8 below.
        }
        try {
          utfText = new TextDecoder("utf-8").decode(bytes);
        } catch (error2) {
          utfText = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, 0, 8000));
        }
        return utfText;
      }

      function importPriceFile(file) {
        if (!file) return;
        writeStorage(true);
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var rows = parsePriceTable(decodePriceTableBuffer(reader.result));
            var priceMap = {};
            rows.forEach(function (row) {
              priceMap[row.code] = row;
            });
            var updated = 0;
            pushUndoSnapshot();
            state.records.forEach(function (record) {
              if (record.archived === true) return;
              if (!record.fields) record.fields = createDefaultFields();
              record.fields = Object.assign(createDefaultFields(), record.fields);
              var code = normalizeStockCode(record.fields.stockCode);
              if (!code || !priceMap[code]) return;
              normalizeRecordBatches(record);
              var importedPrice = String(parseFloat(priceMap[code].price.replace(/,/g, "")));
              record.batches.forEach(function (batch) {
                batch.currentPrice = importedPrice;
              });
              record.fields.currentPrice = importedPrice;
              if (!String(record.fields.symbol || "").trim() && priceMap[code].name) {
                record.fields.symbol = priceMap[code].name;
              }
              record.updatedAt = new Date().toISOString();
              updated += 1;
            });
            if (!updated) {
              showToast("没有匹配到已填写代码的记录");
              return;
            }
            hydrateFields();
            recalc("currentPrice");
            localStorage.setItem(storageKey, JSON.stringify(state));
            renderRecords();
            showToast("已更新 " + updated + " 条价格");
          } catch (error) {
            showToast("导入失败：没有找到证券代码/市价列");
          }
        };
        reader.readAsArrayBuffer(file);
      }

      function importCalcTrialFile(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var importedTrials = parseSupportPressureTable(decodePriceTableBuffer(reader.result));
            if (!importedTrials.length) {
              showToast("没有可导入的目标记录");
              return;
            }
            state.trialRecords = importedTrials.concat(state.trialRecords || []);
            state.currentTrialId = importedTrials[0].id;
            localStorage.setItem(storageKey, JSON.stringify(state));
            loadTrialRecord(state.currentTrialId);
            renderTrialRecords();
            showToast("已导入 " + importedTrials.length + " 条目标");
          } catch (error) {
            showToast("导入失败：没有找到代码/名称/现价/支撑/压力列");
          }
        };
        reader.readAsArrayBuffer(file);
      }

      function populateTimeStopOptions() {
        var timeStop = $("timeStopDays");
        if (!timeStop || timeStop.options.length) return;
        for (var day = 1; day <= 31; day += 1) {
          var option = document.createElement("option");
          option.value = String(day);
          option.textContent = day + " 天";
          timeStop.appendChild(option);
        }
      }

      function setTimeStopEnabled(enabled, silent) {
        var field = $("timeStopField");
        var toggle = $("timeStopToggle");
        var select = $("timeStopDays");
        if (!field || !toggle || !select) return;
        field.classList.toggle("is-disabled", !enabled);
        toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
        select.disabled = !enabled;
        if (!silent) {
          activeRecord().fields.timeStopEnabled = enabled ? "1" : "0";
          writeStorage(true);
          renderRecords();
        }
      }

      function setRiskMarkEnabled(enabled, silent) {
        var field = document.querySelector(".symbol-field");
        var toggle = $("riskMarkToggle");
        if (!field || !toggle) return;
        field.classList.toggle("is-risk-marked", enabled);
        toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
        if (enabled) autoResizeTextArea($("riskNote"));
        if (!silent) {
          activeRecord().fields.riskMarkEnabled = enabled ? "1" : "0";
          writeStorage(true);
          renderRecords();
          if (enabled) {
            window.setTimeout(function () { $("riskNote").focus(); }, 50);
          }
        }
      }

      function autoResizeTextArea(textarea) {
        if (!textarea) return;
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
      }

      function setDynamicStopEnabled(enabled, silent) {
        var control = $("dynamicStopControl");
        var toggle = $("dynamicStopToggle");
        if (!control || !toggle) return;
        control.classList.toggle("is-disabled", !enabled);
        document.body.classList.toggle("dynamic-stop-active", enabled);
        toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
        recalc();
        if (!silent) {
          var record = activeRecord();
          activeBatch(record).dynamicStopEnabled = enabled ? "1" : "0";
          syncActiveBatchToFields(record);
          writeStorage(true);
          renderRecords();
        }
      }

      function hydrateFields() {
        populateTimeStopOptions();
        var record = activeRecord();
        var fields = record.fields;
        var batch = activeBatch(record);
        document.querySelectorAll("[data-account-save]").forEach(function (input) {
          if (!state.accountSettings) state.accountSettings = createDefaultAccountSettings();
          input.value = state.accountSettings[input.dataset.accountSave] !== undefined ? state.accountSettings[input.dataset.accountSave] : "";
        });
        document.querySelectorAll("[data-risk-save]").forEach(function (input) {
          input.value = state.riskSettings && state.riskSettings[input.id] !== undefined ? state.riskSettings[input.id] : "";
        });
        document.querySelectorAll("[data-save]").forEach(function (input) {
          if (isBatchField(input.id) && batch[input.id] !== undefined) {
            input.value = batch[input.id];
          } else if (fields[input.id] !== undefined) {
            input.value = input.id === "buyTime" ? String(fields[input.id]).slice(0, 10) : fields[input.id];
          } else if (createDefaultFields()[input.id] !== undefined) {
            input.value = createDefaultFields()[input.id];
          }
        });

        if (!$("buyTime").value) {
          $("buyTime").value = nowInputValue().slice(0, 10);
        }
        autoResizeTextArea($("riskNote"));
        setRiskMarkEnabled(fields.riskMarkEnabled === "1", true);
        setTimeStopEnabled(fields.timeStopEnabled !== "0", true);
        setDynamicStopEnabled(fields.dynamicStopEnabled !== "0", true);
        renderBatchTabs();
        hydrateArchiveReview();
      }

      function renderBatchTabs() {
        var wrap = $("holdingBatchTabs");
        if (!wrap) return;
        var record = activeRecord();
        normalizeRecordBatches(record);
        Array.prototype.forEach.call(wrap.querySelectorAll("[data-batch-index]"), function (button) {
          var index = parseInt(button.dataset.batchIndex, 10);
          button.classList.toggle("is-active", index === record.currentBatchIndex);
        });
      }

      function setActiveBatch(index) {
        var record = activeRecord();
        if (index < 0 || index >= batchCount || index === record.currentBatchIndex) return;
        pushUndoSnapshot();
        syncVisibleFieldsToRecord(record);
        record.currentBatchIndex = index;
        syncActiveBatchToFields(record);
        hydrateFields();
        renderDynamicStopTags();
        recalc();
        writeStorage(true);
      }

      function getRecordTitle(record) {
        var symbol = (record.fields && record.fields.symbol || "").trim();
        var time = record.fields && record.fields.buyTime
          ? record.fields.buyTime.slice(5, 16).replace("T", " ")
          : "";
        return (symbol || "未命名记录") + (time ? " · " + time : "");
      }

      function parseRecordNumber(record, id) {
        var value = parseFloat(record.fields && record.fields[id]);
        return Number.isFinite(value) ? value : 0;
      }

      function recordExpectedLoss(record) {
        normalizeRecordBatches(record);
        return record.batches.reduce(function (total, batch) {
          if (batch.dynamicStopEnabled !== "0") return total;
          var entry = batchNumber(batch, "entryPrice");
          var stop = batchNumber(batch, "stopPrice");
          var quantity = batchNumber(batch, "quantity");
          var loss = (stop - entry) * quantity;
          return total + (loss < 0 ? Math.abs(loss) : 0);
        }, 0);
      }

      function recordProtectedProfit(record) {
        normalizeRecordBatches(record);
        return record.batches.reduce(function (total, batch) {
          if (batch.dynamicStopEnabled === "0") return total;
          var entry = batchNumber(batch, "entryPrice");
          var dynamicStop = batchNumber(batch, "dynamicStopPrice");
          var quantity = batchNumber(batch, "quantity");
          var profit = (dynamicStop - entry) * quantity;
          return total + (profit > 0 ? profit : 0);
        }, 0);
      }

      function recordTotalQuantity(record) {
        normalizeRecordBatches(record);
        return record.batches.reduce(function (total, batch) {
          return total + batchNumber(batch, "quantity");
        }, 0);
      }

      function recordMarketValue(record) {
        normalizeRecordBatches(record);
        return record.batches.reduce(function (total, batch) {
          var quantity = batchNumber(batch, "quantity");
          var price = batchNumber(batch, "currentPrice") || batchNumber(batch, "entryPrice");
          return total + price * quantity;
        }, 0);
      }

      function totalPositionValue() {
        return state.records.reduce(function (total, record) {
          if (record.archived === true) return total;
          return total + recordMarketValue(record);
        }, 0);
      }

      function renderHomeAccount() {
        if (!state.accountSettings) state.accountSettings = createDefaultAccountSettings();
        var totalAssetsInput = $("homeTotalAssets");
        if (!totalAssetsInput) return;
        if (document.activeElement !== totalAssetsInput) totalAssetsInput.value = state.accountSettings.totalAssets || "";
        var totalPosition = totalPositionValue();
        var totalAssets = parseFloat(state.accountSettings.totalAssets);
        $("homeTotalPosition").textContent = money(totalPosition);
        $("homeTotalPositionRate").textContent = Number.isFinite(totalAssets) && totalAssets > 0 ? signedPercent(totalPosition / totalAssets).replace("+", "") : "0%";
      }
      function recordArchivePnl(record, sellPrice) {
        var price = parseFloat(sellPrice);
        if (!Number.isFinite(price)) return 0;
        normalizeRecordBatches(record);
        return record.batches.reduce(function (total, batch) {
          var entry = batchNumber(batch, "entryPrice");
          var quantity = batchNumber(batch, "quantity");
          return total + (price - entry) * quantity;
        }, 0);
      }

      function archivePnlText(record, sellPrice) {
        if (!sellPrice || !Number.isFinite(parseFloat(sellPrice))) return "-";
        var pnl = recordArchivePnl(record, sellPrice);
        var absValue = Math.abs(pnl);
        return pnl < 0 ? ("亏损 -" + money(absValue)) : ("盈利 +" + money(absValue));
      }

      function archiveTotals() {
        return state.records.reduce(function (totals, record) {
          if (record.archived !== true || !record.archiveInfo || !record.archiveInfo.sellPrice) return totals;
          var pnl = recordArchivePnl(record, record.archiveInfo.sellPrice);
          if (pnl >= 0) totals.profit += pnl;
          if (pnl < 0) totals.loss += Math.abs(pnl);
          return totals;
        }, { profit: 0, loss: 0 });
      }

      function formatRecordValue(value, digits) {
        if (!Number.isFinite(value)) return "-";
        return value.toLocaleString("zh-CN", {
          minimumFractionDigits: 0,
          maximumFractionDigits: digits
        });
      }

      var aShareClosedDays = (function () {
        var closed = {};

        function dateFromYmd(ymd) {
          var parts = ymd.split("-").map(function (part) { return parseInt(part, 10); });
          return new Date(parts[0], parts[1] - 1, parts[2]);
        }

        function toYmd(date) {
          var year = date.getFullYear();
          var month = String(date.getMonth() + 1).padStart(2, "0");
          var day = String(date.getDate()).padStart(2, "0");
          return year + "-" + month + "-" + day;
        }

        function addClosedRange(startYmd, endYmd) {
          var cursor = dateFromYmd(startYmd);
          var end = dateFromYmd(endYmd);
          while (cursor <= end) {
            closed[toYmd(cursor)] = true;
            cursor.setDate(cursor.getDate() + 1);
          }
        }

        addClosedRange("2025-01-01", "2025-01-01");
        addClosedRange("2025-01-28", "2025-02-04");
        addClosedRange("2025-04-04", "2025-04-06");
        addClosedRange("2025-05-01", "2025-05-05");
        addClosedRange("2025-05-31", "2025-06-02");
        addClosedRange("2025-10-01", "2025-10-08");
        addClosedRange("2026-01-01", "2026-01-03");
        addClosedRange("2026-02-15", "2026-02-23");
        addClosedRange("2026-04-04", "2026-04-06");
        addClosedRange("2026-05-01", "2026-05-05");
        addClosedRange("2026-06-19", "2026-06-21");
        addClosedRange("2026-09-25", "2026-09-27");
        addClosedRange("2026-10-01", "2026-10-07");

        return closed;
      })();

      function ymdFromDate(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, "0");
        var day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
      }

      function isAShareTradingDay(date) {
        var day = date.getDay();
        if (day === 0 || day === 6) return false;
        return !aShareClosedDays[ymdFromDate(date)];
      }

      function dateOnlyFromValue(value) {
        var date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) date = new Date();
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
      }

      function addTradingDays(value, tradingDays) {
        var days = parseInt(tradingDays, 10);
        if (!Number.isFinite(days) || days < 0) days = 0;
        var cursor = dateOnlyFromValue(value);
        var counted = 0;
        while (counted < days) {
          cursor.setDate(cursor.getDate() + 1);
          if (isAShareTradingDay(cursor)) counted += 1;
        }
        return ymdFromDate(cursor);
      }

      function signalExpiryDate(createdAt, tradingDays) {
        return addTradingDays(createdAt || new Date(), tradingDays || 5);
      }

      function isActiveSignal(record) {
        return !record || (record.status !== "triggered" && record.status !== "expired");
      }

      function isSignalExpired(record) {
        if (!isActiveSignal(record) || !record.signal || !record.signal.expiresOn) return false;
        var expireDate = dateOnlyFromValue(record.signal.expiresOn);
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return today >= expireDate;
      }

      function nextSignalSelection() {
        if (!Array.isArray(state.signalRecords) || !state.signalRecords.length) return null;
        var active = state.signalRecords.find(isActiveSignal);
        return active ? active.id : state.signalRecords[0].id;
      }

      function pruneExpiredSignals(writeBack) {
        if (!Array.isArray(state.signalRecords)) state.signalRecords = [];
        var changed = 0;
        state.signalRecords.forEach(function (record) {
          if (!isSignalExpired(record)) return;
          record.status = "expired";
          record.expiredAt = record.expiredAt || new Date().toISOString();
          record.updatedAt = new Date().toISOString();
          changed += 1;
        });
        if (state.currentSignalId && !state.signalRecords.some(function (record) { return record.id === state.currentSignalId; })) {
          state.currentSignalId = nextSignalSelection();
        }
        if (!state.currentSignalId) state.currentSignalId = nextSignalSelection();
        if (writeBack && changed) localStorage.setItem(storageKey, JSON.stringify(state));
        return changed;
      }
      function holdingTradingDays(value) {
        if (!value) return null;
        var start = new Date(value);
        if (Number.isNaN(start.getTime())) return null;
        var startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var cursor = new Date(startDate);
        var days = 0;
        cursor.setDate(cursor.getDate() + 1);
        while (cursor <= today) {
          if (isAShareTradingDay(cursor)) days += 1;
          cursor.setDate(cursor.getDate() + 1);
        }
        return Math.max(0, days);
      }

      function holdingDaysFrom(value) {
        var days = holdingTradingDays(value);
        if (days === null) return "-";
        return days + " 交易日";
      }

      function ratioEntryLimit(support, pressure) {
        if (support <= 0 || pressure <= 0 || pressure <= support) return null;
        return (pressure + 2 * support) / 3;
      }

      function calcNumber(id) {
        var el = $(id);
        return el ? parseFloat(el.value) || 0 : 0;
      }

      function pressureInputValue(value) {
        if (!Number.isFinite(value) || value <= 0) return "";
        return String(parseFloat(value.toFixed(4)));
      }

      function setTrendResult(buttonId, textId, value) {
        var button = $(buttonId);
        var text = $(textId);
        var valid = Number.isFinite(value) && value > 0;
        if (button) button.dataset.value = valid ? pressureInputValue(value) : "";
        if (text) text.textContent = valid ? formatRecordValue(value, 4) : "-";
      }

      function recalcTrendPressure() {
        var entry = calcNumber("calcEntry");
        var shapeLow = calcNumber("trendShapeLow");
        var neckline = calcNumber("trendNeckline");
        var start = calcNumber("trendStart") || entry;
        var waveLow = calcNumber("trendWaveLow");
        var waveHigh = calcNumber("trendWaveHigh");
        var shapePressure = neckline > 0 && shapeLow > 0 && neckline > shapeLow
          ? neckline + (neckline - shapeLow)
          : NaN;
        var waveRate = waveLow > 0 && waveHigh > waveLow ? (waveHigh - waveLow) / waveLow : NaN;
        var mapPressure = start > 0 && Number.isFinite(waveRate)
          ? start * (1 + waveRate)
          : NaN;
        var goldenPressure = start > 0 && waveHigh > waveLow && waveLow > 0
          ? start + (waveHigh - waveLow) * 1.618
          : NaN;
        setTrendResult("trendShapeApply", "trendShapePressure", shapePressure);
        setTrendResult("trendMapApply", "trendMapPressure", mapPressure);
        setTrendResult("trendGoldenApply", "trendGoldenPressure", goldenPressure);
      }

      function applyTrendPressure(event) {
        var value = event.currentTarget.dataset.value;
        if (!value) {
          showToast("先填写趋势压力参数");
          return;
        }
        $("calcPressure").value = value;
        recalcTrialCalculator();
      }

      function archiveSummaryText(info) {
        if (!info || !info.sellPrice) return "待复盘";
        var result = info.result === "loss" ? "输" : "赢";
        return result + " / " + info.sellPrice + (info.profitText && info.profitText !== "-" ? " / " + info.profitText : "");
      }

      function getRecordSummary(record) {
        normalizeRecordBatches(record);
        var fields = record.fields || {};
        var logicId = record.selectedLogic || "breakout";
        var batch = record.batches[record.currentBatchIndex || 0] || record.batches[0];
        var entry = batchNumber(batch, "entryPrice");
        var stop = batchNumber(batch, "stopPrice");
        var target = batchNumber(batch, "targetPrice");
        var quantity = record.batches.reduce(function (total, item) { return total + batchNumber(item, "quantity"); }, 0);
        var amount = record.batches.reduce(function (total, item) { return total + batchNumber(item, "entryAmount"); }, 0);
        var risk = Math.abs(entry - stop);
        var reward = Math.abs(target - entry);
        var ratio = risk > 0 ? reward / risk : 0;
        var expectedLoss = recordExpectedLoss(record);
        var singleLimit = parseFloat(state.riskSettings && state.riskSettings.singleLossLimit);
        var holdingDays = holdingTradingDays(fields.buyTime);
        var timeStopLimit = parseInt(fields.timeStopDays, 10);
        var timeStopExceeded = fields.timeStopEnabled !== "0" && holdingDays !== null && Number.isFinite(timeStopLimit) && holdingDays > timeStopLimit;
        return {
          title: (fields.symbol || "未命名记录").trim() || "未命名记录",
          time: fields.buyTime ? fields.buyTime.replace("T", " ") : "未设置时间",
          entry: formatRecordValue(entry, 4),
          target: formatRecordValue(target, 4),
          stop: formatRecordValue(stop, 4),
          quantity: formatRecordValue(quantity, 4),
          amount: formatRecordValue(amount, 2),
          ratio: ratio > 0 ? ratio.toFixed(2) + " : 1" : "-",
          expectedLoss: expectedLoss,
          lossRiskExceeded: Number.isFinite(singleLimit) && singleLimit > 0 && expectedLoss > singleLimit,
          riskMarked: fields.riskMarkEnabled === "1",
          riskNote: fields.riskNote || "",
          logic: getLogicLabel(logicId),
          logicId: logicId,
          dynamicStopActive: record.batches.some(function (item) { return item.dynamicStopEnabled !== "0"; }),
          dynamicStop: record.batches.some(function (item) { return item.dynamicStopEnabled !== "0"; }) ? ((record.dynamicStopTags || []).join(" / ") || "-") : "\u672a\u542f\u7528",
          archiveInfo: record.archiveInfo || null,
          archiveText: record.archiveInfo ? archiveSummaryText(record.archiveInfo) : "-",
          timeStopDays: fields.timeStopEnabled === "0" ? "\u672a\u542f\u7528" : (fields.timeStopDays || "7") + " 天",
          holdingDays: holdingDaysFrom(fields.buyTime),
          timeStopExceeded: timeStopExceeded
        };
      }

      function compactTitle(title) {
        var text = String(title || "未命名").trim();
        if (text.length <= 4) return text;
        return text.slice(0, 4);
      }

      function renderRecordCard(record, index, total) {
        var active = record.id === state.currentId ? " is-active" : "";
        var summary = getRecordSummary(record);
        var logicClass = summary.logicId === "pullback" ? "is-pullback" : "is-breakout";
        var isFirst = index === 0;
        var isLast = index === total - 1;
        var archivedClass = record.archived ? " is-archived" : "";
        var riskMarkedClass = summary.riskMarked ? " is-risk-marked" : "";
        var dynamicStopClass = summary.dynamicStopActive ? " is-dynamic-stop" : "";
        var timeStopClass = summary.timeStopExceeded ? " is-time-stop-warning" : "";
        return '<div class="record-pill ' + logicClass + active + archivedClass + riskMarkedClass + dynamicStopClass + timeStopClass + '" data-record-id="' + record.id + '" role="button" tabindex="0">' +
          '<span class="record-sort" aria-label="\u8bb0\u5f55\u6392\u5e8f">' +
            '<button type="button" class="' + (isFirst ? "is-highlight" : "") + '" data-sort-record="' + record.id + '" data-sort-action="top" aria-label="\u7f6e\u9876">\u21e7</button>' +
            '<button type="button" data-sort-record="' + record.id + '" data-sort-action="up" aria-label="\u4e0a\u79fb"' + (isFirst ? " hidden" : "") + '>\u2191</button>' +
            '<button type="button" data-sort-record="' + record.id + '" data-sort-action="down" aria-label="\u4e0b\u79fb"' + (isLast ? " hidden" : "") + '>\u2193</button>' +
          '</span>' +
          '<span class="record-actions">' +
            '<button type="button" class="record-archive" data-archive-record="' + record.id + '" aria-label="' + (record.archived ? "\u8fd8\u539f\u8bb0\u5f55" : "\u5f52\u6863\u8bb0\u5f55") + '">' + (record.archived ? "\u8fd8" : "\u5f52") + '</button>' +
            '<button type="button" class="record-delete" data-delete-record="' + record.id + '" aria-label="\u5220\u9664\u8bb0\u5f55">&times;</button>' +
          '</span>' +
          '<span class="record-title">' +
            '<span class="record-name">' + escapeHtml(summary.title) + '</span>' +
            '<span class="logic-badge ' + logicClass + '">' + escapeHtml(summary.logic) + '</span>' +
          '</span>' +
          '<span class="record-meta">' + escapeHtml(summary.time) + '</span>' +
          '<span class="record-detail">' +
            '<span class="record-line"><span>\u5165\u573a</span><strong>' + escapeHtml(summary.entry) + '</strong></span>' +
            '<span class="record-line"><span>\u76ee\u6807</span><strong>' + escapeHtml(summary.target) + '</strong></span>' +
            '<span class="record-line' + (summary.lossRiskExceeded ? " is-risk-warning" : "") + '"><span>\u6b62\u635f</span><strong>' + escapeHtml(summary.stop) + '</strong></span>' +
            '<span class="record-line"><span>\u6301\u4ed3</span><strong>' + escapeHtml(summary.quantity) + '</strong></span>' +
            '<span class="record-line"><span>\u5e02\u503c</span><strong>' + escapeHtml(summary.amount) + '</strong></span>' +
            '<span class="record-line"><span>\u76c8\u4e8f\u6bd4</span><strong>' + escapeHtml(summary.ratio) + '</strong></span>' +
            '<span class="record-line"><span>\u52a8\u6001\u6b62\u635f</span><strong>' + escapeHtml(summary.dynamicStop) + '</strong></span>' +
            (summary.riskMarked ? '<span class="record-line"><span>\u98ce\u9669</span><strong>' + escapeHtml(summary.riskNote || "\u5df2\u6807\u8bb0") + '</strong></span>' : '') +
            (record.archived ? '<span class="record-line"><span>\u5f52\u6863</span><strong>' + escapeHtml(summary.archiveText) + '</strong></span>' : '') +
            '<span class="record-line"><span>\u65f6\u95f4\u6b62\u635f</span><strong>' + escapeHtml(summary.timeStopDays) + '</strong></span>' +
            '<span class="record-line"><span>\u6301\u6709</span><strong>' + escapeHtml(summary.holdingDays) + '</strong></span>' +
          '</span>' +
          '<span class="record-compact">' +
            '<span class="record-compact-name">' + escapeHtml(compactTitle(summary.title)) + '</span>' +
            '<span class="record-compact-logic ' + logicClass + '"></span>' +
            '<span>' + escapeHtml(summary.ratio) + '</span>' +
            '<span>' + escapeHtml(summary.holdingDays) + '</span>' +
          '</span>' +
        '</div>';
      }

      function renderRecords() {
        if (document.body.classList.contains("calc-sidebar-mode")) {
          renderTrialRecords();
          return;
        }
        var list = $("recordList");
        if (!list) return;
        if ($("sideTitleLabel")) $("sideTitleLabel").textContent = state.showArchived ? "归档记录" : "保存记录";
        var visibleRecords = state.records.filter(function (record) {
          return state.showArchived ? record.archived === true : record.archived !== true;
        });
        var archiveButton = $("archiveViewBtn");
        if (archiveButton) {
          archiveButton.classList.toggle("is-active", state.showArchived);
          archiveButton.setAttribute("aria-pressed", state.showArchived ? "true" : "false");
          archiveButton.textContent = state.showArchived ? "\u8fd4\u56de" : "\u5f52\u6863";
        }
        if (!visibleRecords.length) {
          list.innerHTML = '<div class="empty-records">' + (state.showArchived ? "\u6682\u65e0\u5f52\u6863\u8bb0\u5f55" : "\u8fd8\u6ca1\u6709\u4fdd\u5b58\u8bb0\u5f55") + '</div>';
          return;
        }
        list.innerHTML = visibleRecords.map(function (record, index) {
          return renderRecordCard(record, index, visibleRecords.length);
        }).join("");
      }

      function getTrialSummary(record) {
        var entry = parseFloat(record.entry) || 0;
        var firstSupport = parseFloat(record.firstSupport || record.stop) || 0;
        var secondSupport = parseFloat(record.secondSupport || record.firstSupport || record.stop) || 0;
        var pressure = parseFloat(record.pressure || record.target) || 0;
        var firstRisk = Math.abs(entry - firstSupport);
        var secondRisk = Math.abs(entry - secondSupport);
        var reward = pressure - entry;
        var firstRatio = firstRisk > 0 ? Math.abs(reward / firstRisk) : 0;
        var secondRatio = secondRisk > 0 ? Math.abs(reward / secondRisk) : 0;
        var entryRangeFirst = ratioEntryLimit(firstSupport, pressure);
        var entryRangeSecond = ratioEntryLimit(secondSupport, pressure);
        var inEntryRangeFirst = entryRangeFirst !== null && entry < entryRangeFirst;
        return {
          title: record.name || "未命名目标",
          code: record.code || "",
          time: record.updatedAt ? record.updatedAt.slice(5, 16).replace("T", " ") : "",
          entry: formatRecordValue(entry, 4),
          firstSupport: formatRecordValue(firstSupport, 4),
          secondSupport: formatRecordValue(secondSupport, 4),
          pressure: formatRecordValue(pressure, 4),
          ratioFirst: firstRatio.toFixed(2) + " : 1",
          ratioSecond: secondRatio.toFixed(2) + " : 1",
          ratioCompact: "\u4e00 " + firstRatio.toFixed(2) + " / \u4e8c " + secondRatio.toFixed(2),
          entryRangeFirst: entryRangeFirst === null ? "-" : formatRecordValue(entryRangeFirst, 2),
          entryRangeSecond: entryRangeSecond === null ? "-" : formatRecordValue(entryRangeSecond, 2),
          inEntryRangeFirst: inEntryRangeFirst,
          profitRate: signedPercent(entry > 0 ? (pressure - entry) / entry : 0),
          supportRate: signedPercent(entry > 0 ? (firstSupport - entry) / entry : 0) + " / " + signedPercent(entry > 0 ? (secondSupport - entry) / entry : 0)
        };
      }

      function renderTrialRecords() {
        var list = $("recordList");
        if (!list) return;
        if ($("sideTitleLabel")) $("sideTitleLabel").textContent = "目标记录";
        if (!state.trialRecords || !state.trialRecords.length) {
          list.innerHTML = '<div class="empty-records">还没有保存目标</div>';
          return;
        }
        list.innerHTML = state.trialRecords.map(function (record) {
          var active = record.id === state.currentTrialId ? " is-active" : "";
          var summary = getTrialSummary(record);
          var rangeClass = summary.inEntryRangeFirst ? " is-range-ok" : "";
          var linkedSignal = findSignalByTrialId(record.id);
          var signalButton = linkedSignal ? '<button type="button" class="record-signal" data-open-trial-signal="' + escapeHtml(linkedSignal.id) + '" aria-label="跳转到信号">信</button>' : '';
          return '<div class="record-pill trial-pill is-breakout' + active + '" data-trial-id="' + record.id + '" role="button" tabindex="0">' +
            '<span class="record-actions">' + signalButton +
              '<button type="button" class="record-delete" data-delete-trial="' + record.id + '" aria-label="删除目标">&times;</button>' +
            '</span>' +
            '<span class="record-title">' +
              '<span class="record-name">' + escapeHtml(summary.title) + '</span>' +
              '<span class="logic-badge is-breakout">目标</span>' +
            '</span>' +
            '<span class="trial-metrics">' +
              '<span>入场范围1 < ' + escapeHtml(summary.entryRangeFirst) + '</span>' +
            '</span>' +
            '<span class="record-compact">' +
              '<span class="record-compact-name">' + escapeHtml(compactTitle(summary.title)) + '</span>' +
              '<span class="record-compact-logic is-breakout' + rangeClass + '"></span>' +
              '<span>< ' + escapeHtml(summary.entryRangeFirst) + '</span>' +
            '</span>' +
          '</div>';
        }).join("");
      }
      function findSignalByTrialId(trialId) {
        if (!trialId || !Array.isArray(state.signalRecords)) return null;
        return state.signalRecords.find(function (record) {
          return record.sourceTrialId === trialId && isActiveSignal(record);
        }) || state.signalRecords.find(function (record) {
          return record.sourceTrialId === trialId;
        }) || null;
      }

      function openSignalRecord(signalId) {
        if (!signalId || !Array.isArray(state.signalRecords)) return;
        if (!state.signalRecords.some(function (record) { return record.id === signalId; })) return;
        state.currentSignalId = signalId;
        localStorage.setItem(storageKey, JSON.stringify(state));
        openSignalPage();
      }
      function activeSignalRecord() {
        pruneExpiredSignals(false);
        if (!Array.isArray(state.signalRecords)) state.signalRecords = [];
        var record = state.signalRecords.find(function (item) { return item.id === state.currentSignalId; });
        if (!record) {
          var nextId = nextSignalSelection();
          record = nextId ? state.signalRecords.find(function (item) { return item.id === nextId; }) : null;
          state.currentSignalId = record ? record.id : null;
        }
        return record || null;
      }

      function signalStatusText(record) {
        if (record && record.status === "triggered") return "已建仓";
        if (record && record.status === "expired") return "未触发";
        return "待验证";
      }

      function signalStatusClass(record) {
        if (record && record.status === "triggered") return " is-triggered";
        if (record && record.status === "expired") return " is-expired";
        return "";
      }

      function floorToFivePercentRate(rate) {
        if (!Number.isFinite(rate) || rate <= 0) return 0;
        return Math.min(1, Math.floor((rate + 1e-10) / 0.05) * 0.05);
      }

      function positionPercentText(rate) {
        var rounded = floorToFivePercentRate(rate);
        if (!Number.isFinite(rounded) || rounded <= 0) return "-";
        return (rounded * 100).toFixed(0) + "%";
      }

      function signalPositionInfo(entryPrice, support, maxLoss) {
        var entry = parseFloat(entryPrice);
        var supportPrice = parseFloat(support);
        var lossLimit = parseFloat(maxLoss);
        var totalAssets = parseFloat(state.accountSettings && state.accountSettings.totalAssets);
        var riskPerUnit = Math.abs(entry - supportPrice);
        if (!Number.isFinite(entry) || !Number.isFinite(supportPrice) || !Number.isFinite(lossLimit) || !Number.isFinite(totalAssets) || entry <= 0 || supportPrice <= 0 || lossLimit <= 0 || totalAssets <= 0 || riskPerUnit <= 0) {
          return { text: "-", shares: 0, value: 0, rate: 0 };
        }
        var maxSharesByLoss = Math.floor(lossLimit / riskPerUnit);
        maxSharesByLoss = Math.floor(maxSharesByLoss / 100) * 100;
        var rawRate = totalAssets > 0 ? (maxSharesByLoss * entry) / totalAssets : 0;
        var rate = floorToFivePercentRate(rawRate);
        var shares = rate > 0 ? Math.floor((totalAssets * rate) / entry / 100) * 100 : 0;
        var value = shares * entry;
        var actualLoss = shares * riskPerUnit;
        if (shares <= 0) rate = 0;
        return {
          text: shares > 0 ? positionPercentText(rate) + "（" + formatRecordValue(shares, 0) + "股，亏 " + money(actualLoss) + "）" : "0%（0股，亏 0.00 元）",
          shares: shares,
          value: value,
          loss: actualLoss,
          rate: rate
        };
      }

      function signalPositionSummary(record) {
        var trial = record.trial || {};
        var signal = record.signal || {};
        var sourceTrial = record.sourceTrialId ? state.trialRecords.find(function (item) { return item.id === record.sourceTrialId; }) : null;
        var limitTrial = sourceTrial || trial;
        var first = signalPositionInfo(signal.entryPrice1, limitTrial.firstSupport || trial.firstSupport, limitTrial.maxLoss || trial.maxLoss);
        var second = signalPositionInfo(signal.entryPrice2, limitTrial.secondSupport || trial.secondSupport, limitTrial.maxLoss || trial.maxLoss);
        return {
          first: first,
          second: second,
          text: "一 " + first.text + "\n二 " + second.text,
          compact: first.rate > 0 ? positionPercentText(first.rate) : "-"
        };
      }

      function signalMetric(label, value, className) {
        var extraClass = className ? " " + className : "";
        return '<div class="signal-metric' + extraClass + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value || "-") + '</strong></div>';
      }

      function renderSignalCard(record, index, total) {
        var active = record.id === state.currentSignalId ? " is-active" : "";
        var statusClass = signalStatusClass(record);
        var signal = record.signal || {};
        var positions = signalPositionSummary(record);
        var isFirst = index === 0;
        var isLast = index === total - 1;
        return '<div class="signal-card' + active + statusClass + '" data-signal-id="' + escapeHtml(record.id) + '" role="button" tabindex="0">' +
          '<span class="signal-sort" aria-label="信号排序">' +
            '<button type="button" class="' + (isFirst ? "is-highlight" : "") + '" data-sort-signal="' + escapeHtml(record.id) + '" data-sort-action="top" aria-label="置顶">⇧</button>' +
            '<button type="button" data-sort-signal="' + escapeHtml(record.id) + '" data-sort-action="up" aria-label="上移"' + (isFirst ? " hidden" : "") + '>↑</button>' +
            '<button type="button" data-sort-signal="' + escapeHtml(record.id) + '" data-sort-action="down" aria-label="下移"' + (isLast ? " hidden" : "") + '>↓</button>' +
          '</span>' +
          '<span class="signal-card-actions">' +
            '<button class="signal-card-delete" type="button" data-delete-signal="' + escapeHtml(record.id) + '" aria-label="删除信号">×</button>' +
          '</span>' +
          '<div class="signal-card-head">' +
            '<strong>' + escapeHtml(record.name || "未命名目标") + '</strong>' +
            '<span>' + escapeHtml(record.code || "无代码") + '</span>' +
          '</div>' +
          '<div class="signal-tags">' +
            '<span>' + escapeHtml(signalStatusText(record)) + '</span>' +
            '<span>入1 ' + escapeHtml(signal.entryPrice1 || "-") + '</span>' +
            '<span>入2 ' + escapeHtml(signal.entryPrice2 || "-") + '</span>' +
            '<span>仓 ' + escapeHtml(positions.compact) + '</span>' +
            '<span>' + escapeHtml(signal.expiresOn || "-") + '</span>' +
          '</div>' +
          '<div class="signal-compact">' +
            '<span class="signal-compact-name">' + escapeHtml(compactTitle(record.name || "未命名目标")) + '</span>' +
            '<span class="signal-compact-dot' + statusClass + '"></span>' +
            '<span>' + escapeHtml(signalStatusText(record)) + '</span>' +
          '</div>' +
        '</div>';
      }

      function renderSignalDetail() {
        var detail = $("signalDetail");
        if (!detail) return;
        var record = activeSignalRecord();
        if (!record) {
          detail.innerHTML = '<div class="signal-detail-empty">选择一个目标发送到信号验证后，这里会显示验证单。</div>';
          return;
        }
        var trial = record.trial || {};
        var signal = record.signal || {};
        var positions = signalPositionSummary(record);
        var statusClass = signalStatusClass(record);
        var triggeredText = record.status === "triggered" ? (" · " + escapeHtml(record.triggeredEntry || "-") + " / " + escapeHtml(record.triggeredPosition || "-") + "%") : "";
        var expiredText = record.status === "expired" ? (" · 到期 " + escapeHtml(record.expiredAt ? record.expiredAt.slice(0, 10) : (signal.expiresOn || "-"))) : "";
        var triggerButton = isActiveSignal(record) ? '<button class="signal-trigger-btn" type="button" data-signal-trigger="' + escapeHtml(record.id) + '">触发建仓</button>' : '';
        detail.innerHTML = '' +
          '<div class="signal-detail-head">' +
            '<div><strong>' + escapeHtml(record.name || "未命名目标") + '</strong><span>' + escapeHtml(record.code || "无代码") + ' · ' + escapeHtml((record.createdAt || "").slice(0, 10)) + triggeredText + expiredText + '</span></div>' +
            '<div class="signal-detail-actions"><button class="signal-source-btn" type="button" data-signal-source="' + escapeHtml(record.id) + '">查看目标</button><span class="signal-status-badge' + statusClass + '">' + escapeHtml(signalStatusText(record)) + '</span></div>' +
          '</div>' +
          '<section class="signal-section">' +
            '<h3>信号部分</h3>' +
            '<div class="signal-metric-grid">' +
              signalMetric("入场价格1", signal.entryPrice1) +
              signalMetric("入场价格2", signal.entryPrice2) +
              signalMetric("最大仓位", positions.text, "is-wide") +
            '</div>' +
            '<div class="signal-expire-control">' +
              '<label><span>有效交易日</span><input data-signal-expire-days="' + escapeHtml(record.id) + '" type="number" inputmode="numeric" min="0" step="1" value="' + escapeHtml(signal.expiresTradingDays || "5") + '"' + (!isActiveSignal(record) ? " disabled" : "") + '></label>' +
              '<div class="signal-expire-output"><span>信号失效时间</span><strong id="signalExpireDateText">' + escapeHtml(signal.expiresOn || "-") + '</strong></div>' +
            '</div>' +
          '</section>' +
          '<section class="signal-section">' +
            '<div class="signal-section-head"><h3>试算部分</h3><button class="signal-section-toggle" type="button" data-signal-trial-toggle>' + (signalTrialCollapsed ? "显示" : "隐藏") + '</button></div>' +
            '<div class="signal-metric-grid' + (signalTrialCollapsed ? " is-hidden" : "") + '">' +
              signalMetric("入场价", trial.entry) +
              signalMetric("第一支撑", trial.firstSupport) +
              signalMetric("第二支撑", trial.secondSupport) +
              signalMetric("压力位", trial.pressure) +
              signalMetric("第一盈亏比", trial.ratioFirst) +
              signalMetric("第二盈亏比", trial.ratioSecond) +
              signalMetric("盈利空间", trial.profitRate) +
              signalMetric("支撑空间", trial.supportRate) +
              signalMetric("形态压力", trial.trendShapePressure) +
              signalMetric("映射压力", trial.trendMapPressure) +
              signalMetric("黄金比压力", trial.trendGoldenPressure) +
            '</div>' +
          '</section>' +

          triggerButton;
      }

      function renderSignalGroup(title, records) {
        if (!records.length) return "";
        return '<section class="signal-list-section"><div class="signal-section-title">' + escapeHtml(title) + '</div>' +
          records.map(function (record, index) { return renderSignalCard(record, index, records.length); }).join("") +
        '</section>';
      }

      function openSignalSourceTrial(signalId) {
        var record = (state.signalRecords || []).find(function (item) { return item.id === signalId; });
        if (!record) return;
        var trial = record.sourceTrialId ? state.trialRecords.find(function (item) { return item.id === record.sourceTrialId; }) : null;
        if (!trial) {
          var trialData = record.trial || {};
          trial = createTrialRecord({
            name: record.name || trialData.name || "未命名目标",
            code: record.code || trialData.code || "",
            entry: trialData.entry || "0",
            quantity: trialData.quantity || "",
            firstSupport: trialData.firstSupport || "0",
            secondSupport: trialData.secondSupport || trialData.firstSupport || "0",
            pressure: trialData.pressure || "0",
            maxLoss: trialData.maxLoss || "",
            trendShapeLow: trialData.trendShapeLow || "",
            trendNeckline: trialData.trendNeckline || "",
            trendStart: trialData.trendStart || "",
            trendWaveLow: trialData.trendWaveLow || "",
            trendWaveHigh: trialData.trendWaveHigh || "",
            selectedLogic: trialData.selectedLogic || "breakout",
            cells: normalizeTrialCells(trialData.cells)
          });
          state.trialRecords.unshift(trial);
          record.sourceTrialId = trial.id;
          record.updatedAt = new Date().toISOString();
        }
        state.currentTrialId = trial.id;
        localStorage.setItem(storageKey, JSON.stringify(state));
        openCalcPage({ fillFromHolding: false });
        loadTrialRecord(trial.id);
        showToast("已打开关联目标");
      }

      function renderSignalRecords() {
        pruneExpiredSignals(true);
        var list = $("signalList");
        var empty = $("signalEmpty");
        if (!list || !empty) return;
        var records = Array.isArray(state.signalRecords) ? state.signalRecords : [];
        var activeRecords = records.filter(isActiveSignal);
        var historyRecords = records.filter(function (record) { return !isActiveSignal(record); });
        if (state.currentSignalId && !records.some(function (record) { return record.id === state.currentSignalId; })) state.currentSignalId = null;
        if (!state.currentSignalId && records.length) state.currentSignalId = activeRecords[0] ? activeRecords[0].id : records[0].id;
        empty.classList.toggle("is-visible", !records.length);
        list.innerHTML = renderSignalGroup("当前信号", activeRecords) + renderSignalGroup("历史信号", historyRecords);
        renderSignalDetail();
      }
      function getLogicLabel(logicId) {
        var logic = cols.find(function (col) { return col.id === logicId; });
        return logic ? logic.label : "形态突破";
      }

      function updateLogicView() {
        var record = activeRecord();
        var logic = record.selectedLogic || "breakout";
        $("recordMatrix").dataset.logic = logic;
        document.querySelectorAll("[data-logic-choice]").forEach(function (button) {
          button.classList.toggle("is-active", button.dataset.logicChoice === logic);
        });
        renderRecords();
      }

      function setLogic(logicId) {
        activeRecord().selectedLogic = logicId;
        updateLogicView();
        writeStorage(true);
      }

      function renderTagManager() {
        var manager = $("tagManager");
        if (!manager) return;
        manager.innerHTML = tagRows.map(function (row) {
          var tags = state.tagLibrary[row.id] || [];
          var list = tags.length
            ? tags.map(function (tag) {
              return '<div class="managed-tag">' +
                '<span>' + escapeHtml(tag) + '</span>' +
                '<button type="button" class="tag-delete" data-row="' + row.id + '" data-tag="' + escapeHtml(tag) + '">删除</button>' +
              '</div>';
            }).join("")
            : '<div class="tag-empty">暂无标签，输入后会出现在此分类的下拉菜单中。</div>';
          return '<section class="tag-section">' +
            '<h3>' + row.label.replace("\n", "") + '</h3>' +
            '<div class="tag-add">' +
              '<input type="text" data-tag-input="' + row.id + '" placeholder="新增标签">' +
              '<button type="button" data-tag-add="' + row.id + '">添加</button>' +
            '</div>' +
            '<div class="managed-tags">' + list + '</div>' +
          '</section>';
        }).join("");
      }

      function updateRiskComparison(currentLoss, currentProtected) {
        var singleLimit = parseFloat(state.riskSettings && state.riskSettings.singleLossLimit);
        var globalLimit = parseFloat(state.riskSettings && state.riskSettings.globalLossLimit);
        var currentExpectedLoss = Math.max(0, Math.abs(currentLoss || 0));
        var singleExceeded = Number.isFinite(singleLimit) && singleLimit > 0 && currentExpectedLoss > singleLimit;
        var currentId = state.currentId;
        var totalExpectedLoss = state.records.reduce(function (total, record) {
          if (record.archived === true) return total;
          return total + (record.id === currentId ? currentExpectedLoss : recordExpectedLoss(record));
        }, 0);
        var protectedTotal = state.records.reduce(function (total, record) {
          if (record.archived === true) return total;
          return total + (record.id === currentId ? Math.max(0, currentProtected || 0) : recordProtectedProfit(record));
        }, 0);
        var netRisk = totalExpectedLoss - protectedTotal;
        var currentMaxLoss = Math.abs(netRisk);
        var currentMaxLossPercent = Number.isFinite(globalLimit) && globalLimit > 0 ? currentMaxLoss / globalLimit : 0;
        var globalExceeded = netRisk > 0 && Number.isFinite(globalLimit) && globalLimit > 0 && netRisk > globalLimit;
        $("lossSummaryRow").classList.toggle("is-risk-warning", singleExceeded);
        $("globalLossLimitField").classList.toggle("is-warning", globalExceeded);
        var currentLabel = $("currentMaxLossField").querySelector("label");
        if (currentLabel) currentLabel.firstChild.nodeValue = netRisk < 0 ? "预计最低盈利 " : "预计最大亏损 ";
        $("currentMaxLossTotal").value = money(currentMaxLoss);
        $("currentMaxLossPercent").textContent = signedPercent(currentMaxLossPercent).replace("+", "");
        $("protectedProfitTotal").value = money(protectedTotal);
      }

      function openTagPage() {
        renderTagManager();
        $("tagPage").classList.add("is-open");
      }

      function closeTagPage() {
        $("tagPage").classList.remove("is-open");
      }

      function renderDynamicStopOptions() {
        var tags = state.tagLibrary.dynamicStop || [];
        return '<option value="">' + (tags.length ? "\u9009\u62e9\u52a8\u6001\u6b62\u635f" : "\u5148\u6dfb\u52a0\u52a8\u6001\u6b62\u635f") + '</option>' + tags.map(function (tag) {
          return '<option value="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</option>';
        }).join("");
      }

      function renderDynamicStopTags() {
        var record = activeRecord();
        var select = $("dynamicStopSelect");
        var list = $("dynamicStopList");
        if (!select || !list) return;
        if (!state.tagLibrary.dynamicStop) state.tagLibrary.dynamicStop = [];
        if (!Array.isArray(record.dynamicStopTags)) record.dynamicStopTags = [];
        select.innerHTML = renderDynamicStopOptions();
        select.value = "";
        list.innerHTML = record.dynamicStopTags.map(function (tag, index) {
          return '<span class="note-tag">' + escapeHtml(tag) +
            '<button type="button" data-index="' + index + '" aria-label="\u5220\u9664\u52a8\u6001\u6b62\u635f">&times;</button></span>';
        }).join("");
      }

      function addDynamicStopTag(value) {
        var tag = value.trim();
        if (!tag) return;
        var record = activeRecord();
        if (!state.tagLibrary.dynamicStop) state.tagLibrary.dynamicStop = [];
        if (state.tagLibrary.dynamicStop.indexOf(tag) === -1) {
          state.tagLibrary.dynamicStop.push(tag);
        }
        if (record.dynamicStopTags.indexOf(tag) === -1) {
          record.dynamicStopTags.push(tag);
        }
        writeStorage(true);
        renderDynamicStopTags();
        renderTagManager();
      }

      function bindDynamicStopTags() {
        var select = $("dynamicStopSelect");
        var openAdd = $("dynamicStopOpenAdd");
        var newTagWrap = $("dynamicStopNewTag");
        var input = $("dynamicStopInput");
        var save = $("dynamicStopSaveTag");
        var list = $("dynamicStopList");
        if (!select || !openAdd || !newTagWrap || !input || !save || !list) return;

        select.addEventListener("change", function () {
          if (select.value) addDynamicStopTag(select.value);
        });

        openAdd.addEventListener("click", function () {
          newTagWrap.classList.toggle("is-open");
          if (newTagWrap.classList.contains("is-open")) input.focus();
        });

        save.addEventListener("click", function () {
          addDynamicStopTag(input.value);
          input.value = "";
          newTagWrap.classList.remove("is-open");
        });

        input.addEventListener("keydown", function (event) {
          if (event.key !== "Enter") return;
          addDynamicStopTag(input.value);
          input.value = "";
          newTagWrap.classList.remove("is-open");
        });

        list.addEventListener("click", function (event) {
          if (!event.target.matches("button")) return;
          var record = activeRecord();
          record.dynamicStopTags.splice(parseInt(event.target.dataset.index, 10), 1);
          writeStorage(true);
          renderDynamicStopTags();
        });
      }

      function addManagedTag(rowId, value) {
        var tag = value.trim();
        if (!tag) return;
        if (!state.tagLibrary[rowId]) state.tagLibrary[rowId] = [];
        if (state.tagLibrary[rowId].indexOf(tag) === -1) {
          state.tagLibrary[rowId].push(tag);
        }
        writeStorage(true);
        refreshSelects();
        renderDynamicStopTags();
        renderTagManager();
      }

      function deleteManagedTag(rowId, tag) {
        if (!window.confirm("确认删除标签“" + tag + "”？已使用的位置也会移除。")) return;
        state.tagLibrary[rowId] = (state.tagLibrary[rowId] || []).filter(function (item) {
          return item !== tag;
        });
        if (rowId === "dynamicStop") {
          state.records.forEach(function (record) {
            record.dynamicStopTags = (record.dynamicStopTags || []).filter(function (item) {
              return item !== tag;
            });
          });
        } else {
          state.records.forEach(function (record) {
            cols.forEach(function (col) {
              var key = getCellKey(rowId, col.id);
              if (record.cells && record.cells[key] && Array.isArray(record.cells[key].tags)) {
                record.cells[key].tags = record.cells[key].tags.filter(function (item) {
                  return item !== tag;
                });
              }
            });
          });
        }
        writeStorage(true);
        renderMatrix();
        renderDynamicStopTags();
        renderTagManager();
        showToast("标签已删除");
      }

      function loadRecord(id) {
        writeStorage(true);
        state.currentId = id;
        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        recalc();
        renderRecords();
        updateLogicView();
      }

      function renderMatrix() {
        var html = rows.map(function (row) {
          var cells = cols.map(function (col) {
            var key = getCellKey(row.id, col.id);
            ensureCell(key);
            return '' +
              '<td class="' + col.id + '-col">' +
                '<div class="cell-box" data-col="' + col.label + '" data-row="' + row.id + '" data-cell="' + key + '">' +
                  '<div class="tag-list" data-role="tagList"></div>' +
                  '<div class="tag-control">' +
                    '<select data-role="select" aria-label="' + row.label.replace("\\n", "") + col.label + '标签">' +
                      renderOptions(row.id) +
                    '</select>' +
                    '<button type="button" data-role="openAdd" aria-label="添加新标签">+</button>' +
                  '</div>' +
                  '<div class="new-tag">' +
                    '<input data-role="newTag" type="text" placeholder="输入新标签">' +
                    '<button type="button" data-role="saveTag" aria-label="保存新标签">✓</button>' +
                  '</div>' +
                '</div>' +
              '</td>';
          }).join("");
          return '<tr><th class="row-title"><span>' + row.label + '</span></th>' + cells + '</tr>';
        }).join("");

        $("matrixBody").innerHTML = html;
        document.querySelectorAll(".cell-box").forEach(bindCell);
        updateLogicView();
      }

      function activeTrialRecord() {
        return state.trialRecords.find(function (item) { return item.id === state.currentTrialId; }) || null;
      }

      function ensureTrialRecordForLogic() {
        var record = activeTrialRecord();
        if (!record) {
          record = upsertTrialRecord(buildTargetValuesFromInputs());
          localStorage.setItem(storageKey, JSON.stringify(state));
          renderTrialRecords();
        }
        if (!record.cells || typeof record.cells !== "object") record.cells = {};
        if (!record.selectedLogic) record.selectedLogic = "breakout";
        return record;
      }

      function ensureTrialCell(key, create) {
        var record = create ? ensureTrialRecordForLogic() : activeTrialRecord();
        if (!record) return { tags: [] };
        if (!record.cells || typeof record.cells !== "object") record.cells = {};
        if (!record.cells[key]) record.cells[key] = { tags: [] };
        if (!Array.isArray(record.cells[key].tags)) record.cells[key].tags = [];
        return record.cells[key];
      }

      function renderTrialMatrix() {
        var body = $("trialMatrixBody");
        if (!body) return;
        var html = rows.map(function (row) {
          var cells = cols.map(function (col) {
            var key = getCellKey(row.id, col.id);
            return '' +
              '<td class="' + col.id + '-col">' +
                '<div class="trial-cell-box" data-col="' + col.label + '" data-row="' + row.id + '" data-cell="' + key + '">' +
                  '<div class="tag-list" data-role="tagList"></div>' +
                  '<div class="tag-control">' +
                    '<select data-role="select" aria-label="' + row.label.replace("\\n", "") + col.label + '标签">' +
                      renderOptions(row.id) +
                    '</select>' +
                    '<button type="button" data-role="openAdd" aria-label="添加新标签">+</button>' +
                  '</div>' +
                  '<div class="new-tag">' +
                    '<input data-role="newTag" type="text" placeholder="输入新标签">' +
                    '<button type="button" data-role="saveTag" aria-label="保存新标签">✓</button>' +
                  '</div>' +
                '</div>' +
              '</td>';
          }).join("");
          return '<tr><th class="row-title"><span>' + row.label + '</span></th>' + cells + '</tr>';
        }).join("");
        body.innerHTML = html;
        document.querySelectorAll(".trial-cell-box").forEach(bindTrialCell);
        updateTrialLogicView();
      }

      function updateTrialLogicView() {
        var matrix = $("trialMatrix");
        if (!matrix) return;
        var record = activeTrialRecord();
        var logic = record && record.selectedLogic ? record.selectedLogic : "breakout";
        matrix.dataset.logic = logic;
        document.querySelectorAll("[data-trial-logic-choice]").forEach(function (button) {
          button.classList.toggle("is-active", button.dataset.trialLogicChoice === logic);
        });
      }

      function setTrialLogic(logicId) {
        var record = ensureTrialRecordForLogic();
        record.selectedLogic = logicId;
        record.updatedAt = new Date().toISOString();
        updateTrialLogicView();
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderTrialRecords();
      }
      function renderOptions(rowId) {
        if (!state.tagLibrary[rowId]) state.tagLibrary[rowId] = [];
        var tags = state.tagLibrary[rowId] || [];
        return '<option value="">' + (tags.length ? "选择标签" : "先添加标签") + '</option>' + tags.map(function (tag) {
          return '<option value="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</option>';
        }).join("");
      }

      function refreshSelects() {
        document.querySelectorAll('[data-role="select"]').forEach(function (select) {
          var current = select.value;
          var box = select.closest(".cell-box, .trial-cell-box");
          if (!box) return;
          var rowId = box.dataset.row;
          select.innerHTML = renderOptions(rowId);
          select.value = current;
        });
      }

      function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (char) {
          return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
          }[char];
        });
      }

      function bindTrialCell(cellEl) {
        var key = cellEl.dataset.cell;
        var rowId = cellEl.dataset.row;
        var select = cellEl.querySelector('[data-role="select"]');
        var tagList = cellEl.querySelector('[data-role="tagList"]');
        var newTagWrap = cellEl.querySelector(".new-tag");
        var newTag = cellEl.querySelector('[data-role="newTag"]');

        function renderTags() {
          var cell = ensureTrialCell(key, false);
          tagList.innerHTML = (cell.tags || []).map(function (tag, index) {
            return '<span class="note-tag">' + escapeHtml(tag) +
              '<button type="button" data-index="' + index + '" aria-label="删除标签">×</button></span>';
          }).join("");
        }

        renderTags();

        select.addEventListener("change", function () {
          if (select.value) {
            var cell = ensureTrialCell(key, true);
            if (cell.tags.indexOf(select.value) === -1) cell.tags.push(select.value);
            activeTrialRecord().updatedAt = new Date().toISOString();
            renderTags();
            localStorage.setItem(storageKey, JSON.stringify(state));
          }
          select.value = "";
        });

        tagList.addEventListener("click", function (event) {
          if (event.target.matches("button")) {
            var cell = ensureTrialCell(key, true);
            cell.tags.splice(parseInt(event.target.dataset.index, 10), 1);
            activeTrialRecord().updatedAt = new Date().toISOString();
            renderTags();
            localStorage.setItem(storageKey, JSON.stringify(state));
          }
        });

        cellEl.querySelector('[data-role="openAdd"]').addEventListener("click", function () {
          newTagWrap.classList.toggle("is-open");
          if (newTagWrap.classList.contains("is-open")) newTag.focus();
        });

        cellEl.querySelector('[data-role="saveTag"]').addEventListener("click", function () {
          var value = newTag.value.trim();
          if (!value) return;
          if (!state.tagLibrary[rowId]) state.tagLibrary[rowId] = [];
          if (state.tagLibrary[rowId].indexOf(value) === -1) {
            state.tagLibrary[rowId].push(value);
            refreshSelects();
            renderTagManager();
          }
          var cell = ensureTrialCell(key, true);
          if (cell.tags.indexOf(value) === -1) cell.tags.push(value);
          activeTrialRecord().updatedAt = new Date().toISOString();
          newTag.value = "";
          newTagWrap.classList.remove("is-open");
          renderTags();
          localStorage.setItem(storageKey, JSON.stringify(state));
          showToast("标签已加入");
        });
      }
      function bindCell(cellEl) {
        var key = cellEl.dataset.cell;
        var rowId = cellEl.dataset.row;
        var cell = ensureCell(key);
        var select = cellEl.querySelector('[data-role="select"]');
        var tagList = cellEl.querySelector('[data-role="tagList"]');
        var newTagWrap = cellEl.querySelector(".new-tag");
        var newTag = cellEl.querySelector('[data-role="newTag"]');

        function renderTags() {
          tagList.innerHTML = cell.tags.map(function (tag, index) {
            return '<span class="note-tag">' + escapeHtml(tag) +
              '<button type="button" data-index="' + index + '" aria-label="删除标签">×</button></span>';
          }).join("");
        }

        renderTags();

        select.addEventListener("change", function () {
          if (select.value && cell.tags.indexOf(select.value) === -1) {
            cell.tags.push(select.value);
            renderTags();
            writeStorage(true);
          }
          select.value = "";
        });

        tagList.addEventListener("click", function (event) {
          if (event.target.matches("button")) {
            cell.tags.splice(parseInt(event.target.dataset.index, 10), 1);
            renderTags();
            writeStorage(true);
          }
        });

        cellEl.querySelector('[data-role="openAdd"]').addEventListener("click", function () {
          newTagWrap.classList.toggle("is-open");
          if (newTagWrap.classList.contains("is-open")) {
            newTag.focus();
          }
        });

        cellEl.querySelector('[data-role="saveTag"]').addEventListener("click", function () {
          var value = newTag.value.trim();
          if (!value) return;
          if (!state.tagLibrary[rowId]) state.tagLibrary[rowId] = [];
          if (state.tagLibrary[rowId].indexOf(value) === -1) {
            state.tagLibrary[rowId].push(value);
            refreshSelects();
            renderTagManager();
          }
          if (cell.tags.indexOf(value) === -1) {
            cell.tags.push(value);
            renderTags();
          }
          newTag.value = "";
          newTagWrap.classList.remove("is-open");
          writeStorage(true);
          showToast("标签已加入");
        });
      }

      function recalc(source) {
        var record = syncVisibleFieldsToRecord(activeRecord());
        var baseEntry = numberValue("entryPrice");
        var current = numberValue("currentPrice");
        var baseStop = numberValue("stopPrice");
        var dynamicStop = numberValue("dynamicStopPrice");
        var dynamicMode = $("dynamicStopToggle").getAttribute("aria-pressed") === "true";
        var entry = dynamicMode ? current : baseEntry;
        var stop = dynamicMode ? dynamicStop : baseStop;
        var target = numberValue("targetPrice");
        var quantity = numberValue("quantity");
        var amount = numberValue("entryAmount");

        if (source === "quantity" && baseEntry > 0) {
          amount = baseEntry * quantity;
          $("entryAmount").value = amount.toFixed(2);
        }

        if (source === "entryAmount" && baseEntry > 0) {
          quantity = amount / baseEntry;
          $("quantity").value = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(4);
        }

        var riskPerUnit = Math.abs(entry - stop);
        var profitPerUnit = target - entry;
        var ratio = riskPerUnit > 0 ? Math.abs(profitPerUnit / riskPerUnit) : 0;
        var profitRate = entry > 0 ? (target - entry) / entry : 0;
        var lossRate = entry > 0 ? (stop - entry) / entry : 0;
        var profitAmount = (target - entry) * quantity;
        var lossAmount = (baseStop - baseEntry) * quantity;
        var dynamicProtectedAmount = (dynamicStop - baseEntry) * quantity;
        var dynamicProtectedRate = baseEntry > 0 ? (dynamicStop - baseEntry) / baseEntry : 0;
        var currentRate = baseEntry > 0 ? (current - baseEntry) / baseEntry : 0;
        var remainingRate = baseEntry > 0 ? (target - current) / baseEntry : 0;
        var totalExpectedLoss = recordExpectedLoss(record);
        var totalProtectedAmount = recordProtectedProfit(record);

        $("lossMeta").textContent = signedFixed(baseStop - baseEntry) + " （" + signedPercent(baseEntry > 0 ? (baseStop - baseEntry) / baseEntry : 0) + "）";
        $("currentMeta").textContent = signedPercent(currentRate);
        $("dynamicStopMeta").textContent = signedFixed(dynamicStop - current) + " （" + signedPercent(current > 0 ? (dynamicStop - current) / current : 0) + "）";
        $("profitMeta").textContent = signedFixed(target - entry) + " （" + signedPercent(profitRate) + "）";
        $("remainingMeta").textContent = "剩余 " + signedPercent(remainingRate);
        $("ratioText").textContent = ratio.toFixed(2) + " : 1";
        $("realRatioText").textContent = realRatioText(profitRate, lossRate);
        $("profitAmount").textContent = money(profitAmount);
        $("profitPercent").textContent = signedPercent(profitRate);
        $("lossAmount").textContent = money(-totalExpectedLoss);
        $("lossPercent").textContent = signedPercent(baseEntry > 0 ? (baseStop - baseEntry) / baseEntry : 0);
        $("protectedAmount").textContent = money(totalProtectedAmount);
        $("protectedPercent").textContent = signedPercent(dynamicProtectedRate);
        $("targetAmount").textContent = money(target * quantity);
        $("stopAmount").textContent = money((dynamicMode ? dynamicStop : baseStop) * quantity);
        $("lossSummaryRow").classList.toggle("is-hidden", dynamicMode);
        $("protectedSummaryRow").classList.toggle("is-hidden", !dynamicMode);
        var holdingDays = holdingTradingDays($("buyTime").value);
        var timeStopLimit = parseInt($("timeStopDays").value, 10);
        var timeStopEnabled = $("timeStopToggle").getAttribute("aria-pressed") === "true";
        $("timeStopField").classList.toggle("is-time-warning", timeStopEnabled && holdingDays !== null && Number.isFinite(timeStopLimit) && holdingDays > timeStopLimit);
        updateRiskComparison(totalExpectedLoss, totalProtectedAmount);
      }

      function applyRatio(ratio) {
        var dynamicMode = $("dynamicStopToggle").getAttribute("aria-pressed") === "true";
        var entry = dynamicMode ? numberValue("currentPrice") : numberValue("entryPrice");
        var stop = dynamicMode ? numberValue("dynamicStopPrice") : numberValue("stopPrice");
        var risk = Math.abs(entry - stop);
        if (entry <= 0 || risk <= 0) return;
        pushUndoSnapshot();
        $("targetPrice").value = (entry + risk * ratio).toFixed(3);
        recalc("targetPrice");
        writeStorage(true);
      }

      function applyLoss(rate) {
        var dynamicMode = $("dynamicStopToggle").getAttribute("aria-pressed") === "true";
        var entry = dynamicMode ? numberValue("currentPrice") : numberValue("entryPrice");
        if (entry <= 0) return;
        var stopFieldId = dynamicMode ? "dynamicStopPrice" : "stopPrice";
        pushUndoSnapshot();
        $(stopFieldId).value = (entry * (1 - rate)).toFixed(3);
        recalc(stopFieldId);
        writeStorage(true);
      }

      function copyText() {
        var lines = [];
        lines.push("名称: " + $("symbol").value);
        lines.push("代码: " + $("stockCode").value);
        lines.push("买入时间: " + $("buyTime").value);
        lines.push("时间止损: " + ($("timeStopToggle").getAttribute("aria-pressed") === "true" ? $("timeStopDays").value + " 天" : "\u672a\u542f\u7528"));
        lines.push("已持有: " + holdingDaysFrom($("buyTime").value));
        lines.push("逻辑: " + getLogicLabel(activeRecord().selectedLogic || "breakout"));
        lines.push("入场单价: " + $("entryPrice").value + " 元");
        lines.push("当前价格: " + $("currentPrice").value + " 元");
        lines.push("止损价格: " + $("stopPrice").value + " 元");
        lines.push("\u52a8\u6001\u6b62\u635f: " + ($("dynamicStopToggle").getAttribute("aria-pressed") === "true" ? (activeRecord().dynamicStopTags || []).map(function (tag) { return "#" + tag; }).join(" ") : "\u672a\u542f\u7528"));
        lines.push("动态止损价: " + $("dynamicStopPrice").value + " 元");
        lines.push("目标价格: " + $("targetPrice").value + " 元");
        lines.push("持仓数量: " + $("quantity").value);
        lines.push("市值: " + $("entryAmount").value + " 元");
        rows.forEach(function (row) {
          cols.forEach(function (col) {
            var cell = ensureCell(getCellKey(row.id, col.id));
            var title = row.label.replace("\n", "") + " / " + col.label;
            var content = []
              .concat(cell.tags.map(function (tag) { return "#" + tag; }))
              .join(" ");
            lines.push(title + ": " + content);
          });
        });

        var text = lines.join("\n");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            showToast("已复制文本");
          }, fallbackCopy.bind(null, text));
        } else {
          fallbackCopy(text);
        }
      }

      function splitPastedLine(line) {
        var colon = line.indexOf(":");
        var fullColon = line.indexOf("\uff1a");
        var index = colon;
        if (index === -1 || (fullColon !== -1 && fullColon < index)) index = fullColon;
        if (index === -1) return null;
        return {
          key: line.slice(0, index).trim(),
          value: line.slice(index + 1).trim()
        };
      }

      function escapeRegExp(text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      function pasteLabels() {
        var labels = [
          "\u6807\u7684\u540d\u79f0",
          "\u4ee3\u7801",
          "\u8bc1\u5238\u4ee3\u7801",
          "\u80a1\u7968\u4ee3\u7801",
          "\u4e70\u5165\u65f6\u95f4",
          "\u65f6\u95f4\u6b62\u635f",
          "\u5df2\u6301\u6709",
          "\u903b\u8f91",
          "\u5165\u573a\u5355\u4ef7",
          "\u5f53\u524d\u4ef7\u683c",
          "\u6b62\u635f\u5355\u4ef7",
          "\u52a8\u6001\u6b62\u635f",
          "\u52a8\u6001\u6b62\u635f\u4ef7",
          "\u76ee\u6807\u5355\u4ef7",
          "\u4ea4\u6613\u6570\u91cf",
          "\u5165\u573a\u603b\u91d1\u989d"
        ];
        rows.forEach(function (row) {
          cols.forEach(function (col) {
            labels.push(row.label.replace("\n", "") + " / " + col.label);
          });
        });
        return labels.sort(function (a, b) {
          return b.length - a.length;
        });
      }

      function normalizePastedText(text) {
        var normalized = String(text || "").replace(/\r/g, "\n");
        pasteLabels().forEach(function (label) {
          var pattern = new RegExp("\\s*(" + escapeRegExp(label) + "\\s*[:\uff1a])", "g");
          normalized = normalized.replace(pattern, "\n$1");
        });
        return normalized.replace(/\n{2,}/g, "\n").trim();
      }

      function stripUnit(value) {
        return String(value || "").replace(/[\s\u5143\u5929]/g, "").trim();
      }

      function parseHashTags(value) {
        var tags = [];
        String(value || "").split(/\s+/).forEach(function (part) {
          var tag = part.replace(/^#/, "").trim();
          if (tag && tags.indexOf(tag) === -1) tags.push(tag);
        });
        return tags;
      }

      function rememberTags(rowId, tags) {
        if (!state.tagLibrary[rowId]) state.tagLibrary[rowId] = [];
        tags.forEach(function (tag) {
          if (state.tagLibrary[rowId].indexOf(tag) === -1) {
            state.tagLibrary[rowId].push(tag);
          }
        });
      }

      function applyPastedText(text) {
        var record = activeRecord();
        var fieldLabels = {};
        fieldLabels["\u540d\u79f0"] = "symbol";
        fieldLabels["\u6807\u7684\u540d\u79f0"] = "symbol";
        fieldLabels["\u4ee3\u7801"] = "stockCode";
        fieldLabels["\u8bc1\u5238\u4ee3\u7801"] = "stockCode";
        fieldLabels["\u80a1\u7968\u4ee3\u7801"] = "stockCode";
        fieldLabels["\u4e70\u5165\u65f6\u95f4"] = "buyTime";
        fieldLabels["\u5165\u573a\u5355\u4ef7"] = "entryPrice";
        fieldLabels["\u5f53\u524d\u4ef7\u683c"] = "currentPrice";
        fieldLabels["\u6b62\u635f\u4ef7\u683c"] = "stopPrice";
        fieldLabels["\u6b62\u635f\u5355\u4ef7"] = "stopPrice";
        fieldLabels["\u52a8\u6001\u6b62\u635f\u4ef7"] = "dynamicStopPrice";
        fieldLabels["\u76ee\u6807\u4ef7\u683c"] = "targetPrice";
        fieldLabels["\u76ee\u6807\u5355\u4ef7"] = "targetPrice";
        fieldLabels["\u6301\u4ed3\u6570\u91cf"] = "quantity";
        fieldLabels["\u4ea4\u6613\u6570\u91cf"] = "quantity";
        fieldLabels["\u5e02\u503c"] = "entryAmount";
        fieldLabels["\u5165\u573a\u603b\u91d1\u989d"] = "entryAmount";

        normalizePastedText(text).split(/\r?\n/).forEach(function (rawLine) {
          var parsed = splitPastedLine(rawLine);
          if (!parsed) return;
          var key = parsed.key;
          var value = parsed.value;
          var fieldId = fieldLabels[key];

          if (fieldId) {
            var cleanValue = fieldId === "buyTime" ? value.slice(0, 10) : stripUnit(value);
            if (isBatchField(fieldId)) {
              activeBatch(record)[fieldId] = cleanValue;
              syncActiveBatchToFields(record);
            } else {
              record.fields[fieldId] = cleanValue;
            }
            return;
          }

          if (key === "\u65f6\u95f4\u6b62\u635f") {
            if (value.indexOf("\u672a\u542f\u7528") !== -1) {
              record.fields.timeStopEnabled = "0";
            } else {
              record.fields.timeStopEnabled = "1";
              record.fields.timeStopDays = stripUnit(value) || record.fields.timeStopDays || "7";
            }
            return;
          }

          if (key === "\u903b\u8f91") {
            record.selectedLogic = value === getLogicLabel("pullback") || value.indexOf("\u56de\u8c03") !== -1 ? "pullback" : "breakout";
            return;
          }

          if (key === "\u52a8\u6001\u6b62\u635f") {
            if (value.indexOf("\u672a\u542f\u7528") !== -1) {
              activeBatch(record).dynamicStopEnabled = "0";
              syncActiveBatchToFields(record);
              return;
            }
            activeBatch(record).dynamicStopEnabled = "1";
            syncActiveBatchToFields(record);
            record.dynamicStopTags = parseHashTags(value);
            rememberTags("dynamicStop", record.dynamicStopTags);
            return;
          }

          rows.forEach(function (row) {
            cols.forEach(function (col) {
              var title = row.label.replace("\n", "") + " / " + col.label;
              if (key !== title) return;
              var tags = parseHashTags(value);
              ensureCell(getCellKey(row.id, col.id)).tags = tags;
              rememberTags(row.id, tags);
            });
          });
        });

        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        recalc();
        renderRecords();
        renderTagManager();
        renderSignalRecords();
        renderHomeAccount();
        updateLogicView();
        writeStorage(true);
        showToast("\u6587\u672c\u5df2\u7c98\u8d34");
      }

      function pasteText() {
        function fallbackPastePage() {
          openPastePage("");
        }

        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(function (text) {
            if (text && text.trim()) {
              applyPastedText(text);
            } else {
              fallbackPastePage();
            }
          }, fallbackPastePage);
        } else {
          fallbackPastePage();
        }
      }

      function openPastePage(text) {
        var area = $("pasteTextArea");
        area.value = text || "";
        $("pastePage").classList.add("is-open");
        window.setTimeout(function () {
          area.focus();
        }, 50);
      }

      function closePastePage() {
        $("pastePage").classList.remove("is-open");
      }

      function applyPastePageText() {
        var text = $("pasteTextArea").value;
        if (!text.trim()) {
          showToast("\u8bf7\u5148\u7c98\u8d34\u6587\u672c");
          return;
        }
        applyPastedText(text);
        closePastePage();
      }

      function recalcTrialCalculator() {
        var entry = parseFloat($("calcEntry").value) || 0;
        var firstSupport = parseFloat($("calcSupport1").value) || 0;
        var secondSupport = parseFloat($("calcSupport2").value) || 0;
        var pressure = parseFloat($("calcPressure").value) || 0;
        var maxLoss = parseFloat($("calcMaxLoss").value) || 0;
        var quantity = parseFloat($("calcQuantity").value) || 0;
        var firstRisk = Math.abs(entry - firstSupport);
        var secondRisk = Math.abs(entry - secondSupport);
        var reward = pressure - entry;
        var firstRatio = firstRisk > 0 ? Math.abs(reward / firstRisk) : 0;
        var secondRatio = secondRisk > 0 ? Math.abs(reward / secondRisk) : 0;
        var trialProfitRate = entry > 0 ? (pressure - entry) / entry : 0;
        var firstLossRate = entry > 0 ? (firstSupport - entry) / entry : 0;
        var secondLossRate = entry > 0 ? (secondSupport - entry) / entry : 0;
        $("calcRatioFirst").textContent = firstRatio.toFixed(2) + " : 1";
        $("calcRatioSecond").textContent = secondRatio.toFixed(2) + " : 1";
        $("calcRealRatioFirst").textContent = realRatioText(trialProfitRate, firstLossRate);
        $("calcRealRatioSecond").textContent = realRatioText(trialProfitRate, secondLossRate);
        $("calcProfitRate").textContent = signedPercent(trialProfitRate);
        $("calcSupportRate").textContent = signedPercent(firstLossRate) + " / " + signedPercent(secondLossRate);
        var currentLossText = quantity > 0 ? ("当前亏损 一 " + formatRecordValue(firstRisk * quantity, 2) + " / 二 " + formatRecordValue(secondRisk * quantity, 2)) : "当前亏损 -";
        var maxPositionTextValue = "最大仓位 一 " + maxPositionText(maxLoss, firstRisk, entry) + " / 二 " + maxPositionText(maxLoss, secondRisk, entry);
        $("calcMaxPosition").textContent = currentLossText + " · " + maxPositionTextValue;
        recalcTrendPressure();
        updateTrialEntryRange(entry, firstSupport, secondSupport, pressure, firstRatio, secondRatio);
      }

      function maxPositionText(maxLoss, riskPerUnit, entry) {
        var totalAssets = parseFloat(state.accountSettings && state.accountSettings.totalAssets);
        if (maxLoss <= 0 || riskPerUnit <= 0 || entry <= 0 || !Number.isFinite(totalAssets) || totalAssets <= 0) return "-";
        var units = Math.floor(maxLoss / riskPerUnit);
        units = Math.floor(units / 100) * 100;
        var rawRate = units > 0 ? (units * entry) / totalAssets : 0;
        var rate = floorToFivePercentRate(rawRate);
        var roundedUnits = rate > 0 ? Math.floor((totalAssets * rate) / entry / 100) * 100 : 0;
        return roundedUnits > 0 ? positionPercentText(rate) + " / " + formatRecordValue(roundedUnits, 0) + "股" : "0%";
      }

      function updateTrialEntryRange(entry, firstSupport, secondSupport, pressure, firstRatio, secondRatio) {
        var showRange = firstRatio < 2 || secondRatio < 2;
        var firstLimit = ratioEntryLimit(firstSupport, pressure);
        var secondLimit = ratioEntryLimit(secondSupport, pressure);
        var parts = [];
        if (firstLimit !== null) parts.push("\u5165\u573a\u8303\u56f41 < " + formatRecordValue(firstLimit, 2));
        if (secondLimit !== null) parts.push("\u5165\u573a\u8303\u56f42 < " + formatRecordValue(secondLimit, 2));
        $("calcEntryRange").textContent = parts.length ? parts.join("\n") : "-";
        $("calcEntryRangeRow").classList.toggle("is-hidden", !showRange || !parts.length || entry <= 0 || pressure <= 0);
      }

      function fillCalcFromMain() {
        $("calcName").value = $("symbol").value ? $("symbol").value + " 目标" : "";
        $("calcCode").value = $("stockCode").value || "";
        $("calcEntry").value = $("currentPrice").value || $("entryPrice").value || "10";
        $("calcQuantity").value = $("quantity").value || "";
        $("calcSupport1").value = $("dynamicStopToggle").getAttribute("aria-pressed") === "true" ? $("dynamicStopPrice").value : $("stopPrice").value;
        $("calcSupport2").value = $("calcSupport1").value;
        $("calcPressure").value = $("targetPrice").value || "12.5";
        $("calcMaxLoss").value = state.riskSettings && state.riskSettings.singleLossLimit ? state.riskSettings.singleLossLimit : "";
        $("trendShapeLow").value = $("calcSupport1").value || "";
        $("trendNeckline").value = $("calcEntry").value || "";
        $("trendStart").value = $("calcEntry").value || "";
        $("trendWaveLow").value = "";
        $("trendWaveHigh").value = "";
        state.currentTrialId = null;
        recalcTrialCalculator();
      }

      function applyTrialValuesToRecord(record, values) {
        record.name = values.name;
        record.code = values.code;
        record.entry = values.entry;
        record.quantity = values.quantity;
        record.firstSupport = values.firstSupport;
        record.secondSupport = values.secondSupport;
        record.pressure = values.pressure;
        record.maxLoss = values.maxLoss;
        record.trendShapeLow = values.trendShapeLow;
        record.trendNeckline = values.trendNeckline;
        record.trendStart = values.trendStart;
        record.trendWaveLow = values.trendWaveLow;
        record.trendWaveHigh = values.trendWaveHigh;
        record.updatedAt = values.updatedAt || new Date().toISOString();
        return record;
      }

      function upsertTrialRecord(values) {
        var record = state.trialRecords.find(function (item) { return item.id === state.currentTrialId; });
        if (!record) {
          record = createTrialRecord(values);
          state.trialRecords.unshift(record);
          state.currentTrialId = record.id;
        } else {
          applyTrialValuesToRecord(record, values);
        }
        return record;
      }

      function saveTrialRecord() {
        var values = buildTargetValuesFromInputs();
        upsertTrialRecord(values);
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderTrialRecords();
        renderTrialMatrix();
        showToast("已保存目标");
      }

      function loadTrialRecord(trialId) {
        var record = state.trialRecords.find(function (item) { return item.id === trialId; });
        if (!record) return;
        state.currentTrialId = record.id;
        $("calcName").value = record.name || "";
        $("calcCode").value = record.code || "";
        $("calcEntry").value = record.entry || "10";
        $("calcQuantity").value = record.quantity || "";
        $("calcSupport1").value = record.firstSupport || record.stop || "9";
        $("calcSupport2").value = record.secondSupport || record.firstSupport || record.stop || "9";
        $("calcPressure").value = record.pressure || record.target || "12.5";
        $("calcMaxLoss").value = record.maxLoss || "";
        $("trendShapeLow").value = record.trendShapeLow || "";
        $("trendNeckline").value = record.trendNeckline || "";
        $("trendStart").value = record.trendStart || "";
        $("trendWaveLow").value = record.trendWaveLow || "";
        $("trendWaveHigh").value = record.trendWaveHigh || "";
        recalcTrialCalculator();
        renderTrialRecords();
        renderTrialMatrix();
        localStorage.setItem(storageKey, JSON.stringify(state));
      }

      function deleteTrialRecord(trialId) {
        state.trialRecords = state.trialRecords.filter(function (record) { return record.id !== trialId; });
        if (state.currentTrialId === trialId) state.currentTrialId = null;
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderTrialRecords();
        renderTrialMatrix();
        showToast("已删除目标");
      }

      function clearTrialInputs() {
        state.currentTrialId = null;
        $("calcName").value = "";
        $("calcCode").value = "";
        $("calcEntry").value = "";
        $("calcQuantity").value = "";
        $("calcSupport1").value = "";
        $("calcSupport2").value = "";
        $("calcPressure").value = "";
        $("calcMaxLoss").value = "";
        $("trendShapeLow").value = "";
        $("trendNeckline").value = "";
        $("trendStart").value = "";
        $("trendWaveLow").value = "";
        $("trendWaveHigh").value = "";
        recalcTrialCalculator();
        renderTrialRecords();
        renderTrialMatrix();
        $("calcEntry").focus();
      }

      function convertTrialToRecord() {
        var entry = $("calcEntry").value || "0";
        var firstSupport = $("calcSupport1").value || "0";
        var secondSupport = $("calcSupport2").value || firstSupport;
        var pressure = $("calcPressure").value || "0";
        var fields = createDefaultFields();
        var quantity = parseFloat(fields.quantity) || 0;
        var entryNumber = parseFloat(entry) || 0;
        fields.symbol = $("calcName").value.trim().replace(/\s*目标$/, "") || "目标记录";
        fields.stockCode = $("calcCode").value.trim();
        fields.entryPrice = entry;
        fields.currentPrice = entry;
        fields.stopPrice = secondSupport || firstSupport;
        fields.dynamicStopPrice = secondSupport || firstSupport;
        fields.targetPrice = pressure;
        fields.dynamicStopEnabled = "0";
        fields.timeStopEnabled = "1";
        fields.entryAmount = (entryNumber * quantity).toFixed(2);
        pushUndoSnapshot();
        var record = createRecord(fields, {});
        record.selectedLogic = "breakout";
        state.records.unshift(record);
        state.currentId = record.id;
        openHoldingRecordsPage();
        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        updateLogicView();
        recalc();
        writeStorage(true);
        renderRecords();
        showToast("已转为持仓记录");
      }

      function buildTargetValuesFromInputs() {
        return {
          name: $("calcName").value.trim() || "未命名目标",
          code: $("calcCode").value.trim(),
          entry: $("calcEntry").value || "0",
          quantity: $("calcQuantity").value || "",
          firstSupport: $("calcSupport1").value || "0",
          secondSupport: $("calcSupport2").value || "0",
          pressure: $("calcPressure").value || "0",
          maxLoss: $("calcMaxLoss").value || "",
          trendShapeLow: $("trendShapeLow").value || "",
          trendNeckline: $("trendNeckline").value || "",
          trendStart: $("trendStart").value || "",
          trendWaveLow: $("trendWaveLow").value || "",
          trendWaveHigh: $("trendWaveHigh").value || "",
          updatedAt: new Date().toISOString()
        };
      }

      function sendTargetToSignalValidation() {
        recalcTrialCalculator();
        var values = buildTargetValuesFromInputs();
        var sourceRecord = upsertTrialRecord(values);
        var summary = getTrialSummary(values);
        var entryPrice1 = summary.entryRangeFirst === "-" ? "" : summary.entryRangeFirst;
        var entryPrice2 = summary.entryRangeSecond === "-" ? "" : summary.entryRangeSecond;
        var signal = createSignalRecord({
          sourceTrialId: sourceRecord.id,
          name: values.name,
          code: values.code,
          trial: {
            name: values.name,
            code: values.code,
            entry: values.entry,
            quantity: values.quantity,
            firstSupport: values.firstSupport,
            secondSupport: values.secondSupport,
            pressure: values.pressure,
            maxLoss: values.maxLoss,
            ratioFirst: summary.ratioFirst,
            ratioSecond: summary.ratioSecond,
            profitRate: summary.profitRate,
            supportRate: summary.supportRate,
            trendShapePressure: $("trendShapePressure").textContent || "-",
            trendMapPressure: $("trendMapPressure").textContent || "-",
            trendGoldenPressure: $("trendGoldenPressure").textContent || "-",
            selectedLogic: sourceRecord.selectedLogic || "breakout",
            cells: normalizeTrialCells(sourceRecord.cells)
          },
          signal: {
            entryPrice1: entryPrice1,
            entryPrice2: entryPrice2,
            expiresTradingDays: "5"
          },
          conditions: [
            { label: "入场价", value: summary.entry },
            { label: "持仓数量", value: values.quantity || "-" },
            { label: "逻辑", value: getLogicLabel(sourceRecord.selectedLogic || "breakout") },
            { label: "第一支撑", value: summary.firstSupport },
            { label: "第二支撑", value: summary.secondSupport },
            { label: "压力位", value: summary.pressure },
            { label: "入场价格1", value: entryPrice1 ? "< " + entryPrice1 : "-" },
            { label: "入场价格2", value: entryPrice2 ? "< " + entryPrice2 : "-" },
            { label: "第一盈亏比", value: summary.ratioFirst },
            { label: "第二盈亏比", value: summary.ratioSecond },
            { label: "盈利空间", value: summary.profitRate },
            { label: "支撑空间", value: summary.supportRate },
            { label: "形态压力", value: $("trendShapePressure").textContent || "-" },
            { label: "映射压力", value: $("trendMapPressure").textContent || "-" },
            { label: "黄金比压力", value: $("trendGoldenPressure").textContent || "-" }
          ]
        });
        if (!Array.isArray(state.signalRecords)) state.signalRecords = [];
        state.signalRecords.unshift(signal);
        state.currentSignalId = signal.id;
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderTrialRecords();
        renderSignalRecords();
        openSignalPage();
        showToast("已发送到信号验证");
      }

      function closeFloatingPages() {
        ["tagPage", "pastePage", "archivePage", "calcPage", "signalPage", "signalBuildPage"].forEach(function (id) {
          if ($(id)) $(id).classList.remove("is-open");
        });
      }

      function showSystemHome() {
        closeFloatingPages();
        renderHomeAccount();
        document.body.classList.add("system-home-mode");
        document.body.classList.remove("calc-sidebar-mode", "signal-page-mode");
      }

      function openHoldingRecordsPage() {
        closeFloatingPages();
        state.showArchived = false;
        var current = state.records.find(function (record) { return record.id === state.currentId; });
        if (!current || current.archived === true) {
          var next = state.records.find(function (record) { return record.archived !== true; });
          if (!next) {
            next = createRecord();
            state.records.unshift(next);
          }
          state.currentId = next.id;
          hydrateFields();
          renderDynamicStopTags();
          renderMatrix();
          recalc();
        }
        document.body.classList.remove("system-home-mode", "calc-sidebar-mode", "signal-page-mode");
        hydrateArchiveReview();
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderRecords();
      }

      function openArchiveRecordsPage() {
        closeFloatingPages();
        state.showArchived = true;
        var archivedRecord = state.records.find(function (record) { return record.archived === true; });
        if (archivedRecord) {
          state.currentId = archivedRecord.id;
          hydrateFields();
          renderDynamicStopTags();
          renderMatrix();
          recalc();
        }
        document.body.classList.remove("system-home-mode", "calc-sidebar-mode", "signal-page-mode");
        hydrateArchiveReview();
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderRecords();
      }

      function openSignalPage() {
        var removed = pruneExpiredSignals(true);
        closeFloatingPages();
        document.body.classList.remove("system-home-mode", "calc-sidebar-mode");
        document.body.classList.add("signal-page-mode");
        $("signalPage").classList.add("is-open");
        renderSignalRecords();
        if (removed) showToast("已清理 " + removed + " 条过期信号");
      }

      function closeSignalPage() {
        closeSignalBuildPage();
        $("signalPage").classList.remove("is-open");
        document.body.classList.remove("signal-page-mode");
        showSystemHome();
      }

      function openCalcPage(options) {
        var fillFromHolding = options && options.fillFromHolding === true;
        document.body.classList.remove("system-home-mode", "signal-page-mode");
        $("signalPage").classList.remove("is-open");
        $("signalBuildPage").classList.remove("is-open");
        if (fillFromHolding) {
          fillCalcFromMain();
        } else if (state.currentTrialId) {
          loadTrialRecord(state.currentTrialId);
        } else {
          recalcTrialCalculator();
        }
        renderTrialMatrix();
        document.body.classList.add("calc-sidebar-mode");
        $("calcPage").classList.add("is-open");
        renderTrialRecords();
      }

      function closeCalcPage() {
        $("calcPage").classList.remove("is-open");
        document.body.classList.remove("calc-sidebar-mode");
        showSystemHome();
      }
      function fallbackCopy(text) {
        var temp = document.createElement("textarea");
        temp.value = text;
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        temp.remove();
        showToast("已复制文本");
      }

      function resetAll() {
        if (!window.confirm("确认清空当前记录？标签库会保留。")) return;
        pushUndoSnapshot();
        var record = activeRecord();
        record.fields = createDefaultFields();
        record.currentBatchIndex = 0;
        record.batches = [
          createDefaultBatch(record.fields),
          createDefaultBatch(record.fields, true),
          createDefaultBatch(record.fields, true)
        ];
        record.cells = {};
        record.dynamicStopTags = [];
        record.archived = false;
        record.archiveInfo = null;
        localStorage.setItem(storageKey, JSON.stringify(state));
        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        recalc();
        renderRecords();
      }

      function newRecord() {
        pushUndoSnapshot();
        writeStorage(true);
        var record = createRecord();
        state.records.unshift(record);
        state.currentId = record.id;
        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        recalc();
        writeStorage(true);
        showToast("已新建记录");
      }

      function deleteRecord(recordId) {
        var targetId = recordId || state.currentId;
        if (!window.confirm("确认删除这条保存记录？")) return;
        pushUndoSnapshot();
        state.records = state.records.filter(function (record) {
          return record.id !== targetId;
        });
        if (!state.records.length) {
          state.records.push(createRecord());
        }
        if (state.currentId === targetId) {
          state.currentId = state.records[0].id;
        }
        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        recalc();
        writeStorage(true);
        showToast("已删除记录");
      }

      function sortRecord(recordId, action) {
        pushUndoSnapshot();
        var visibleRecords = state.records.filter(function (record) {
          return state.showArchived ? record.archived === true : record.archived !== true;
        });
        var visibleIndex = visibleRecords.findIndex(function (record) { return record.id === recordId; });
        if (visibleIndex === -1) return;
        var targetRecord = null;
        if (action === "top") targetRecord = visibleRecords[0];
        if (action === "up") targetRecord = visibleRecords[Math.max(0, visibleIndex - 1)];
        if (action === "down") targetRecord = visibleRecords[Math.min(visibleRecords.length - 1, visibleIndex + 1)];
        if (!targetRecord || targetRecord.id === recordId) return;
        var sourceIndex = state.records.findIndex(function (record) { return record.id === recordId; });
        var targetIndex = state.records.findIndex(function (record) { return record.id === targetRecord.id; });
        var moved = state.records.splice(sourceIndex, 1)[0];
        targetIndex = state.records.findIndex(function (record) { return record.id === targetRecord.id; });
        if (action === "down") targetIndex += 1;
        state.records.splice(targetIndex, 0, moved);
        writeStorage(true);
        renderRecords();
        showToast("\u8bb0\u5f55\u987a\u5e8f\u5df2\u66f4\u65b0");
      }

      function setArchiveView(showArchived) {
        state.showArchived = showArchived;
        var next = state.records.find(function (record) {
          return showArchived ? record.archived === true : record.archived !== true;
        });
        var current = state.records.find(function (record) { return record.id === state.currentId; });
        if (next && (!current || current.archived !== showArchived)) {
          state.currentId = next.id;
          hydrateFields();
          renderDynamicStopTags();
          renderMatrix();
          recalc();
        }
        localStorage.setItem(storageKey, JSON.stringify(state));
        hydrateArchiveReview();
        renderRecords();
      }

      function archiveRecord(recordId) {
        var record = state.records.find(function (item) { return item.id === recordId; });
        if (!record) return;
        pushUndoSnapshot();
        if (!record.archived) {
          record.archiveInfo = record.archiveInfo && typeof record.archiveInfo === "object" ? record.archiveInfo : {};
          record.archiveInfo.result = record.archiveInfo.result || "win";
          record.archiveInfo.sellPrice = record.archiveInfo.sellPrice || "";
          record.archiveInfo.profitText = record.archiveInfo.profitText || "-";
          record.archiveInfo.entryJudgement = record.archiveInfo.entryJudgement || "";
          record.archiveInfo.marketTruth = record.archiveInfo.marketTruth || "";
          record.archiveInfo.archivedAt = record.archiveInfo.archivedAt || new Date().toISOString();
          record.archived = true;
        } else {
          record.archived = false;
        }
        if (record.archived && state.currentId === recordId && !state.showArchived) {
          var next = state.records.find(function (item) {
            return item.archived !== true;
          });
          if (!next) {
            next = createRecord();
            state.records.unshift(next);
          }
          state.currentId = next.id;
          hydrateFields();
          renderDynamicStopTags();
          renderMatrix();
          recalc();
        }
        if (!record.archived && state.currentId === recordId && state.showArchived) {
          var nextArchived = state.records.find(function (item) {
            return item.archived === true;
          });
          if (nextArchived) {
            state.currentId = nextArchived.id;
          } else {
            state.showArchived = false;
          }
          hydrateFields();
          renderDynamicStopTags();
          renderMatrix();
          recalc();
        }
        writeStorage(true);
        renderRecords();
        showToast(record.archived ? "\u5df2\u5f52\u6863" : "\u5df2\u8fd8\u539f");
      }

      function openArchivePage(recordId) {
        pendingArchiveId = recordId;
        $("archiveResult").value = "win";
        $("archiveSellPrice").value = "";
        $("archiveEntryJudgement").value = "";
        $("archiveMarketTruth").value = "";
        updateArchivePnlPreview();
        $("archivePage").classList.add("is-open");
        window.setTimeout(function () {
          $("archiveSellPrice").focus();
        }, 50);
      }

      function closeArchivePage() {
        pendingArchiveId = null;
        $("archivePage").classList.remove("is-open");
      }

      function updateArchivePnlPreview() {
        var record = state.records.find(function (item) { return item.id === pendingArchiveId; });
        if (!$("archivePnlPreview")) return;
        $("archivePnlPreview").value = record ? archivePnlText(record, $("archiveSellPrice").value.trim()) : "-";
      }

      function hydrateArchiveReview() {
        var record = activeRecord();
        var info = record.archiveInfo || {};
        var archived = record.archived === true && state.showArchived === true;
        document.body.classList.toggle("archive-review-mode", archived);
        if (!$("archiveReviewPnl")) return;
        var totals = archiveTotals();
        $("archiveTotalProfit").value = money(totals.profit);
        $("archiveTotalLoss").value = money(totals.loss);
        $("archiveReviewSellPrice").value = info.sellPrice || "";
        $("archiveReviewPnl").value = info.profitText || "-";
        $("archiveReviewEntry").value = info.entryJudgement || "";
        $("archiveReviewTruth").value = info.marketTruth || "";
      }

      function saveArchiveSellPrice(value) {
        var record = activeRecord();
        if (record.archived !== true) return;
        if (!record.archiveInfo) record.archiveInfo = {};
        record.archiveInfo.sellPrice = value;
        var pnl = recordArchivePnl(record, value);
        record.archiveInfo.result = Number.isFinite(parseFloat(value)) && pnl < 0 ? "loss" : "win";
        record.archiveInfo.profitText = archivePnlText(record, value);
        record.updatedAt = new Date().toISOString();
        if ($("archiveReviewPnl")) $("archiveReviewPnl").value = record.archiveInfo.profitText || "-";
        var totals = archiveTotals();
        if ($("archiveTotalProfit")) $("archiveTotalProfit").value = money(totals.profit);
        if ($("archiveTotalLoss")) $("archiveTotalLoss").value = money(totals.loss);
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderRecords();
      }

      function saveArchiveReviewField(field, value) {
        var record = activeRecord();
        if (record.archived !== true) return;
        if (!record.archiveInfo) record.archiveInfo = {};
        record.archiveInfo[field] = value;
        record.updatedAt = new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderRecords();
      }

      function applyArchivePage() {
        var record = state.records.find(function (item) { return item.id === pendingArchiveId; });
        var sellPrice = $("archiveSellPrice").value.trim();
        if (!record) {
          closeArchivePage();
          return;
        }
        if (!sellPrice || !Number.isFinite(parseFloat(sellPrice))) {
          showToast("\u8bf7\u586b\u5199\u5356\u51fa\u4ef7\u683c");
          return;
        }
        pushUndoSnapshot();
        var result = $("archiveResult").value === "loss" ? "loss" : "win";
        record.archiveInfo = {
          result: result,
          sellPrice: sellPrice,
          archivedAt: new Date().toISOString(),
          profitText: archivePnlText(record, sellPrice),
          entryJudgement: $("archiveEntryJudgement").value.trim(),
          marketTruth: $("archiveMarketTruth").value.trim()
        };
        record.archived = true;
        if (state.currentId === record.id && !state.showArchived) {
          var next = state.records.find(function (item) { return item.archived !== true; });
          if (!next) {
            next = createRecord();
            state.records.unshift(next);
          }
          state.currentId = next.id;
          hydrateFields();
          renderDynamicStopTags();
          renderMatrix();
          recalc();
        }
        writeStorage(true);
        renderRecords();
        closeArchivePage();
        showToast("\u5df2\u5f52\u6863");
      }

      function loadSignalRecord(signalId) {
        if (!state.signalRecords.some(function (record) { return record.id === signalId; })) return;
        state.currentSignalId = signalId;
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderSignalRecords();
      }

      function deleteSignalRecord(signalId) {
        state.signalRecords = (state.signalRecords || []).filter(function (record) { return record.id !== signalId; });
        if (state.currentSignalId === signalId) state.currentSignalId = nextSignalSelection();
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderSignalRecords();
        showToast("已删除信号");
      }

      function sortSignalRecord(signalId, action) {
        var records = state.signalRecords || [];
        var record = records.find(function (item) { return item.id === signalId; });
        if (!record) return;
        var activeGroup = isActiveSignal(record);
        var visibleRecords = records.filter(function (item) { return isActiveSignal(item) === activeGroup; });
        var visibleIndex = visibleRecords.findIndex(function (item) { return item.id === signalId; });
        if (visibleIndex === -1) return;
        var targetRecord = null;
        if (action === "top") targetRecord = visibleRecords[0];
        if (action === "up") targetRecord = visibleRecords[Math.max(0, visibleIndex - 1)];
        if (action === "down") targetRecord = visibleRecords[Math.min(visibleRecords.length - 1, visibleIndex + 1)];
        if (!targetRecord || targetRecord.id === signalId) return;
        var sourceIndex = records.findIndex(function (item) { return item.id === signalId; });
        var targetIndex = records.findIndex(function (item) { return item.id === targetRecord.id; });
        var moved = records.splice(sourceIndex, 1)[0];
        targetIndex = records.findIndex(function (item) { return item.id === targetRecord.id; });
        if (action === "down") targetIndex += 1;
        records.splice(targetIndex, 0, moved);
        localStorage.setItem(storageKey, JSON.stringify(state));
        renderSignalRecords();
        showToast("信号顺序已更新");
      }

      function updateSignalExpiry(signalId, tradingDays) {
        var record = (state.signalRecords || []).find(function (item) { return item.id === signalId; });
        if (!record || !isActiveSignal(record)) return;
        if (!record.signal) record.signal = normalizeSignalMetaData({}, record.trial || {}, [], record.createdAt);
        var days = parseInt(tradingDays, 10);
        if (!Number.isFinite(days) || days < 0) days = 0;
        record.signal.expiresTradingDays = String(days);
        record.signal.expiresOn = signalExpiryDate(record.createdAt, days);
        record.updatedAt = new Date().toISOString();
        if ($("signalExpireDateText")) $("signalExpireDateText").textContent = record.signal.expiresOn || "-";
        localStorage.setItem(storageKey, JSON.stringify(state));
        if (isSignalExpired(record)) {
          pruneExpiredSignals(true);
          renderSignalRecords();
          showToast("信号已到期并进入历史");
        }
      }

      function chooseSignalStop(record, entry) {
        var trial = record.trial || {};
        var signal = record.signal || {};
        var firstSupport = parseFloat(trial.firstSupport);
        var secondSupport = parseFloat(trial.secondSupport);
        var entryPrice2 = parseFloat(signal.entryPrice2);
        if (Number.isFinite(entryPrice2) && entry <= entryPrice2 && Number.isFinite(secondSupport) && secondSupport > 0) return String(secondSupport);
        if (Number.isFinite(firstSupport) && firstSupport > 0) return String(firstSupport);
        if (Number.isFinite(secondSupport) && secondSupport > 0) return String(secondSupport);
        return String(entry);
      }

      function positionInputToRate(value) {
        var number = parseFloat(value);
        if (!Number.isFinite(number) || number <= 0) return 0;
        return number > 1 ? number / 100 : number;
      }

      function positionPercentInput(rate) {
        var rounded = floorToFivePercentRate(rate);
        return Number.isFinite(rounded) && rounded > 0 ? (rounded * 100).toFixed(0) : "";
      }

      function updateSignalBuildHint() {
        var entry = parseFloat($("signalBuildEntry").value);
        var rate = floorToFivePercentRate(positionInputToRate($("signalBuildPosition").value));
        var totalAssets = parseFloat(state.accountSettings && state.accountSettings.totalAssets);
        var hint = $("signalBuildHint");
        if (!hint) return;
        if (!Number.isFinite(totalAssets) || totalAssets <= 0) {
          hint.textContent = "请先在主页填写总资产，用它换算仓位和持仓数量。";
          return;
        }
        if (!Number.isFinite(entry) || entry <= 0 || rate <= 0) {
          hint.textContent = "会按总资产把仓位向下取整到 5% 档，再换算 100 股。";
          return;
        }
        var marketValue = totalAssets * rate;
        var quantity = Math.floor(marketValue / entry / 100) * 100;
        hint.textContent = "预计市值 " + money(marketValue) + "，持仓数量 " + formatRecordValue(Math.max(0, quantity), 0) + " 股。";
      }

      function openSignalBuildPage(signalId) {
        var record = (state.signalRecords || []).find(function (item) { return item.id === signalId; });
        if (!record) return;
        pendingSignalBuildId = signalId;
        var signal = record.signal || {};
        var positions = signalPositionSummary(record);
        $("signalBuildEntry").value = signal.entryPrice1 || (record.trial && record.trial.entry) || "";
        $("signalBuildPosition").value = positionPercentInput(positions.first.rate);
        updateSignalBuildHint();
        $("signalBuildPage").classList.add("is-open");
        window.setTimeout(function () { $("signalBuildEntry").focus(); }, 50);
      }

      function closeSignalBuildPage() {
        pendingSignalBuildId = null;
        $("signalBuildPage").classList.remove("is-open");
      }

      function applySignalBuildPage() {
        var record = (state.signalRecords || []).find(function (item) { return item.id === pendingSignalBuildId; });
        if (!record) {
          closeSignalBuildPage();
          return;
        }
        var entry = parseFloat($("signalBuildEntry").value);
        var rate = floorToFivePercentRate(positionInputToRate($("signalBuildPosition").value));
        var totalAssets = parseFloat(state.accountSettings && state.accountSettings.totalAssets);
        if (!Number.isFinite(totalAssets) || totalAssets <= 0) {
          showToast("请先在主页填写总资产");
          return;
        }
        if (!Number.isFinite(entry) || entry <= 0 || rate <= 0) {
          showToast("请填写入场价格和仓位");
          return;
        }
        var quantity = Math.floor((totalAssets * rate) / entry / 100) * 100;
        if (quantity <= 0) {
          showToast("按当前仓位换算后不足 100 股");
          return;
        }
        var trial = record.trial || {};
        var stop = chooseSignalStop(record, entry);
        var fields = createDefaultFields();
        fields.symbol = String(record.name || "信号建仓").replace(/\s*目标$/, "") || "信号建仓";
        fields.stockCode = record.code || "";
        fields.buyTime = nowInputValue().slice(0, 10);
        fields.entryPrice = String(entry);
        fields.currentPrice = String(entry);
        fields.stopPrice = stop;
        fields.dynamicStopPrice = stop;
        fields.targetPrice = trial.pressure || String(entry);
        fields.quantity = String(quantity);
        fields.entryAmount = (entry * quantity).toFixed(2);
        fields.dynamicStopEnabled = "0";
        fields.timeStopEnabled = "1";
        pushUndoSnapshot();
        var holding = createRecord(fields, {});
        holding.selectedLogic = "breakout";
        holding.sourceSignalId = record.id;
        state.records.unshift(holding);
        state.currentId = holding.id;
        record.status = "triggered";
        record.triggeredAt = new Date().toISOString();
        record.triggeredEntry = String(entry);
        record.triggeredPosition = positionPercentInput(rate);
        record.updatedAt = new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify(state));
        closeSignalBuildPage();
        openHoldingRecordsPage();
        showToast("已生成持仓记录");
      }

      function handleSignalListAction(event) {
        var sortButton = event.target.closest("[data-sort-signal]");
        if (sortButton) {
          event.preventDefault();
          event.stopPropagation();
          sortSignalRecord(sortButton.dataset.sortSignal, sortButton.dataset.sortAction);
          return;
        }
        var deleteButton = event.target.closest("[data-delete-signal]");
        if (deleteButton) {
          event.preventDefault();
          event.stopPropagation();
          deleteSignalRecord(deleteButton.dataset.deleteSignal);
          return;
        }
        if (event.type !== "click") return;
        var card = event.target.closest("[data-signal-id]");
        if (card) loadSignalRecord(card.dataset.signalId);
      }

      function handleSignalDetailAction(event) {
        var sourceButton = event.target.closest("[data-signal-source]");
        if (sourceButton) {
          openSignalSourceTrial(sourceButton.dataset.signalSource);
          return;
        }
        var trialToggle = event.target.closest("[data-signal-trial-toggle]");
        if (trialToggle) {
          signalTrialCollapsed = !signalTrialCollapsed;
          renderSignalDetail();
          return;
        }
        var triggerButton = event.target.closest("[data-signal-trigger]");
        if (triggerButton) openSignalBuildPage(triggerButton.dataset.signalTrigger);
      }
      function handleRecordListAction(event) {
        if (document.body.classList.contains("calc-sidebar-mode")) {
          var trialSignalButton = event.target.closest("[data-open-trial-signal]");
          if (trialSignalButton) {
            event.preventDefault();
            event.stopPropagation();
            openSignalRecord(trialSignalButton.dataset.openTrialSignal);
            return;
          }
          var trialDeleteButton = event.target.closest("[data-delete-trial]");
          if (trialDeleteButton) {
            event.preventDefault();
            event.stopPropagation();
            deleteTrialRecord(trialDeleteButton.dataset.deleteTrial);
            return;
          }
          if (event.type !== "click") return;
          var trialButton = event.target.closest("[data-trial-id]");
          if (trialButton) loadTrialRecord(trialButton.dataset.trialId);
          return;
        }
        var sortButton = event.target.closest("[data-sort-record]");
        if (sortButton) {
          event.preventDefault();
          event.stopPropagation();
          sortRecord(sortButton.dataset.sortRecord, sortButton.dataset.sortAction);
          return;
        }
        var archiveButton = event.target.closest("[data-archive-record]");
        if (archiveButton) {
          event.preventDefault();
          event.stopPropagation();
          archiveRecord(archiveButton.dataset.archiveRecord);
          return;
        }
        var deleteButton = event.target.closest("[data-delete-record]");
        if (deleteButton) {
          event.preventDefault();
          event.stopPropagation();
          var now = Date.now();
          if (handleRecordListAction.lastDeleteAt && now - handleRecordListAction.lastDeleteAt < 700) return;
          handleRecordListAction.lastDeleteAt = now;
          deleteRecord(deleteButton.dataset.deleteRecord);
          return;
        }
        if (event.type !== "click") return;
        var button = event.target.closest("[data-record-id]");
        if (button) loadRecord(button.dataset.recordId);
      }

      function setSignalSidebarCompact(isCompact) {
        var sidebar = $("signalSidebar");
        var toggle = $("signalSidebarToggle");
        if (!sidebar || !toggle) return;
        document.body.classList.toggle("signal-sidebar-compact", isCompact);
        sidebar.classList.toggle("is-compact", isCompact);
        toggle.textContent = isCompact ? "展开" : "收起";
        try {
          localStorage.setItem("trade-record-signal-sidebar-compact", isCompact ? "1" : "0");
        } catch (error) {}
      }

      function hydrateSignalSidebarMode() {
        var shouldCompact = window.matchMedia && window.matchMedia("(max-width: 680px)").matches;
        try {
          var saved = localStorage.getItem("trade-record-signal-sidebar-compact");
          if (saved === "1") shouldCompact = true;
          if (saved === "0") shouldCompact = false;
        } catch (error) {}
        setSignalSidebarCompact(shouldCompact);
      }
      function setSidebarCompact(isCompact) {
        document.body.classList.toggle("sidebar-compact", isCompact);
        $("sidebar").classList.toggle("is-compact", isCompact);
        $("sidebarToggle").textContent = isCompact ? "展开" : "收起";
        try {
          localStorage.setItem("trade-record-sidebar-compact", isCompact ? "1" : "0");
        } catch (error) {}
      }

      function hydrateSidebarMode() {
        var shouldCompact = window.matchMedia && window.matchMedia("(max-width: 680px)").matches;
        try {
          var saved = localStorage.getItem("trade-record-sidebar-compact");
          if (saved === "1") shouldCompact = true;
          if (saved === "0") shouldCompact = false;
        } catch (error) {}
        setSidebarCompact(shouldCompact);
      }

      function bindSidebarSwipe() {
        var sidebar = $("sidebar");
        var swipeZone = $("sidebarSwipeZone");
        var startX = 0;
        var startY = 0;
        var startTarget = null;
        var tracking = false;

        function onStart(event) {
          if (!event.touches || event.touches.length !== 1) return;
          startX = event.touches[0].clientX;
          startY = event.touches[0].clientY;
          startTarget = event.target;
          tracking = true;
        }

        function onEnd(event) {
          if (!tracking || !event.changedTouches || event.changedTouches.length !== 1) return;
          tracking = false;
          var dx = event.changedTouches[0].clientX - startX;
          var dy = event.changedTouches[0].clientY - startY;
          if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
          if ($("calcPage").classList.contains("is-open")) {
            if (dx > 0) closeCalcPage();
            return;
          }
          if ($("signalPage").classList.contains("is-open")) {
            if ($("signalBuildPage").classList.contains("is-open")) return;
            var signalSidebar = $("signalSidebar");
            var signalCompact = signalSidebar && signalSidebar.classList.contains("is-compact");
            var fromSignalSidebar = startTarget && startTarget.closest && startTarget.closest("#signalSidebar");
            var signalFromLeftEdge = startX <= 84;
            var signalFromLeftHalf = startX <= window.innerWidth * 0.5;
            if (signalCompact) {
              if (!signalFromLeftHalf) return;
              if (dx > 0) setSignalSidebarCompact(false);
              return;
            }
            if (!fromSignalSidebar && !signalFromLeftEdge) return;
            if (dx < 0) setSignalSidebarCompact(true);
            return;
          }
          var isCompact = $("sidebar").classList.contains("is-compact");
          var fromSidebar = startTarget && startTarget.closest && startTarget.closest("#sidebar");
          var fromLeftEdge = startX <= 84;
          var fromLeftHalf = startX <= window.innerWidth * 0.5;
          if (isCompact) {
            if (!fromLeftHalf) return;
            if (dx < 0) openCalcPage({ fillFromHolding: true });
            if (dx > 0) setSidebarCompact(false);
            return;
          }
          if (!fromSidebar && !fromLeftEdge) return;
          setSidebarCompact(dx < 0);
        }

        [document].forEach(function (target) {
          if (!target) return;
          target.addEventListener("touchstart", onStart, { passive: true });
          target.addEventListener("touchend", onEnd, { passive: true });
        });
      }

      function bindEvents() {
        document.querySelectorAll("[data-save]").forEach(function (input) {
          input.addEventListener("focus", function () {
            pushUndoSnapshot();
          });
          input.addEventListener("input", function () {
            if (input.tagName === "TEXTAREA") autoResizeTextArea(input);
            recalc(input.id);
            writeStorage(true);
          });
          input.addEventListener("change", function () {
            recalc(input.id);
            writeStorage(true);
          });
        });

        if ($("holdingBatchTabs")) {
          $("holdingBatchTabs").addEventListener("click", function (event) {
            var button = event.target.closest("[data-batch-index]");
            if (!button) return;
            setActiveBatch(parseInt(button.dataset.batchIndex, 10));
          });
        }

        document.querySelectorAll("[data-account-save]").forEach(function (input) {
          input.addEventListener("input", function () {
            if (!state.accountSettings) state.accountSettings = createDefaultAccountSettings();
            state.accountSettings[input.dataset.accountSave] = input.value;
            localStorage.setItem(storageKey, JSON.stringify(state));
            renderHomeAccount();
            renderSignalRecords();
          });
          input.addEventListener("change", function () {
            if (!state.accountSettings) state.accountSettings = createDefaultAccountSettings();
            state.accountSettings[input.dataset.accountSave] = input.value;
            localStorage.setItem(storageKey, JSON.stringify(state));
            renderHomeAccount();
            renderSignalRecords();
          });
        });
        document.querySelectorAll("[data-risk-save]").forEach(function (input) {
          input.addEventListener("focus", function () {
            pushUndoSnapshot();
          });
          input.addEventListener("input", function () {
            if (!state.riskSettings) state.riskSettings = createDefaultRiskSettings();
            state.riskSettings[input.id] = input.value;
            recalc(input.id);
            writeStorage(true);
            renderRecords();
          });
          input.addEventListener("change", function () {
            if (!state.riskSettings) state.riskSettings = createDefaultRiskSettings();
            state.riskSettings[input.id] = input.value;
            recalc(input.id);
            writeStorage(true);
            renderRecords();
          });
        });

        $("timeStopToggle").addEventListener("click", function () {
          pushUndoSnapshot();
          setTimeStopEnabled($("timeStopToggle").getAttribute("aria-pressed") !== "true", false);
        });
        $("riskMarkToggle").addEventListener("click", function () {
          pushUndoSnapshot();
          setRiskMarkEnabled($("riskMarkToggle").getAttribute("aria-pressed") !== "true", false);
        });
        $("dynamicStopToggle").addEventListener("click", function () {
          pushUndoSnapshot();
          setDynamicStopEnabled($("dynamicStopToggle").getAttribute("aria-pressed") !== "true", false);
        });

        document.querySelectorAll("[data-ratio]").forEach(function (button) {
          button.addEventListener("click", function () {
            applyRatio(parseFloat(button.dataset.ratio));
          });
        });

        document.querySelectorAll("[data-loss]").forEach(function (button) {
          button.addEventListener("click", function () {
            applyLoss(parseFloat(button.dataset.loss));
          });
        });

        $("saveBtn").addEventListener("click", function () { writeStorage(false); });
        $("newBtn").addEventListener("click", newRecord);
        $("undoBtn").addEventListener("click", undoChange);
        $("redoBtn").addEventListener("click", redoChange);
        $("homeBtn").addEventListener("click", showSystemHome);
        $("homeTargetBtn").addEventListener("click", function () { openCalcPage({ fillFromHolding: false }); });
        $("homeSignalBtn").addEventListener("click", openSignalPage);
        $("homeHoldingBtn").addEventListener("click", openHoldingRecordsPage);
        $("homeArchiveBtn").addEventListener("click", openArchiveRecordsPage);
        $("tagManageBtn").addEventListener("click", openTagPage);
        $("closeTagPageBtn").addEventListener("click", closeTagPage);
        $("copyBtn").addEventListener("click", copyText);
        $("importPriceBtn").addEventListener("click", function () {
          $("priceImportFile").click();
        });
        $("pasteBtn").addEventListener("click", pasteText);
        $("closePastePageBtn").addEventListener("click", closePastePage);
        $("cancelPasteBtn").addEventListener("click", closePastePage);
        $("applyPasteBtn").addEventListener("click", applyPastePageText);
        $("closeArchivePageBtn").addEventListener("click", closeArchivePage);
        $("cancelArchiveBtn").addEventListener("click", closeArchivePage);
        $("applyArchiveBtn").addEventListener("click", applyArchivePage);
        ["archiveSellPrice", "archiveResult"].forEach(function (id) {
          $(id).addEventListener("input", updateArchivePnlPreview);
          $(id).addEventListener("change", updateArchivePnlPreview);
        });
        document.querySelectorAll("[data-archive-review]").forEach(function (input) {
          input.addEventListener("input", function () {
            saveArchiveReviewField(input.dataset.archiveReview, input.value);
          });
        });
        if ($("archiveReviewSellPrice")) {
          $("archiveReviewSellPrice").addEventListener("input", function () {
            saveArchiveSellPrice($("archiveReviewSellPrice").value.trim());
          });
        }
        $("closeCalcPageBtn").addEventListener("click", closeCalcPage);
        $("closeSignalPageBtn").addEventListener("click", closeSignalPage);
        $("closeSignalBuildPageBtn").addEventListener("click", closeSignalBuildPage);
        $("cancelSignalBuildBtn").addEventListener("click", closeSignalBuildPage);
        $("applySignalBuildBtn").addEventListener("click", applySignalBuildPage);
        ["signalBuildEntry", "signalBuildPosition"].forEach(function (id) {
          $(id).addEventListener("input", updateSignalBuildHint);
        });
        $("saveCalcTrialBtn").addEventListener("click", saveTrialRecord);
        $("sendSignalBtn").addEventListener("click", sendTargetToSignalValidation);
        if ($("convertCalcTrialBtn")) $("convertCalcTrialBtn").addEventListener("click", convertTrialToRecord);
        $("newCalcTrialBtn").addEventListener("click", clearTrialInputs);
        $("clearCalcTrialBtn").addEventListener("click", clearTrialInputs);
        $("importCalcTrialsBtn").addEventListener("click", function () {
          $("calcTrialImportFile").click();
        });
        $("calcTrialImportFile").addEventListener("change", function (event) {
          importCalcTrialFile(event.target.files && event.target.files[0]);
          event.target.value = "";
        });
        ["calcEntry", "calcQuantity", "calcSupport1", "calcSupport2", "calcPressure", "calcMaxLoss", "trendShapeLow", "trendNeckline", "trendStart", "trendWaveLow", "trendWaveHigh"].forEach(function (id) {
          $(id).addEventListener("input", recalcTrialCalculator);
        });
        ["trendShapeApply", "trendMapApply", "trendGoldenApply"].forEach(function (id) {
          $(id).addEventListener("click", applyTrendPressure);
        });
        $("exportRecordsBtn").addEventListener("click", exportRecords);
        $("importRecordsBtn").addEventListener("click", function () {
          $("importRecordsFile").click();
        });
        $("importRecordsFile").addEventListener("change", function (event) {
          importRecordsFile(event.target.files && event.target.files[0]);
          event.target.value = "";
        });
        $("priceImportFile").addEventListener("change", function (event) {
          importPriceFile(event.target.files && event.target.files[0]);
          event.target.value = "";
        });
        $("sidebarToggle").addEventListener("click", function () {
          setSidebarCompact(!$("sidebar").classList.contains("is-compact"));
        });
        if ($("signalSidebarToggle")) {
          $("signalSidebarToggle").addEventListener("click", function () {
            setSignalSidebarCompact(!$("signalSidebar").classList.contains("is-compact"));
          });
        }
        bindSidebarSwipe();
        document.querySelectorAll("[data-logic-choice]").forEach(function (button) {
          button.addEventListener("click", function () {
            setLogic(button.dataset.logicChoice);
          });
        });
        document.querySelectorAll("[data-trial-logic-choice]").forEach(function (button) {
          button.addEventListener("click", function () {
            setTrialLogic(button.dataset.trialLogicChoice);
          });
        });
        $("signalList").addEventListener("click", handleSignalListAction);
        $("signalList").addEventListener("touchend", handleSignalListAction, { passive: false });
        $("signalList").addEventListener("pointerup", handleSignalListAction);
        $("signalDetail").addEventListener("click", handleSignalDetailAction);
        $("signalDetail").addEventListener("input", function (event) {
          var input = event.target.closest("[data-signal-expire-days]");
          if (input && input.value !== "") updateSignalExpiry(input.dataset.signalExpireDays, input.value);
        });
        $("recordList").addEventListener("click", handleRecordListAction);
        $("recordList").addEventListener("touchend", handleRecordListAction, { passive: false });
        $("recordList").addEventListener("pointerup", handleRecordListAction);
        $("signalList").addEventListener("keydown", function (event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          var card = event.target.closest("[data-signal-id]");
          if (card && !event.target.closest("[data-delete-signal]")) {
            event.preventDefault();
            loadSignalRecord(card.dataset.signalId);
          }
        });
        $("recordList").addEventListener("keydown", function (event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          if (document.body.classList.contains("calc-sidebar-mode")) {
            var trialCard = event.target.closest("[data-trial-id]");
            if (trialCard && !event.target.closest("[data-delete-trial]")) {
              event.preventDefault();
              loadTrialRecord(trialCard.dataset.trialId);
            }
            return;
          }
          var card = event.target.closest("[data-record-id]");
          if (card && !event.target.closest("[data-delete-record]")) {
            event.preventDefault();
            loadRecord(card.dataset.recordId);
          }
        });
        $("tagManager").addEventListener("click", function (event) {
          var addButton = event.target.closest("[data-tag-add]");
          var deleteButton = event.target.closest("[data-tag]");
          if (addButton) {
            var rowId = addButton.dataset.tagAdd;
            var input = document.querySelector('[data-tag-input="' + rowId + '"]');
            addManagedTag(rowId, input.value);
          } else if (deleteButton) {
            deleteManagedTag(deleteButton.dataset.row, deleteButton.dataset.tag);
          }
        });
        $("tagManager").addEventListener("keydown", function (event) {
          if (event.key !== "Enter") return;
          var input = event.target.closest("[data-tag-input]");
          if (input) addManagedTag(input.dataset.tagInput, input.value);
        });
      }

      function init() {
        els.toast = $("toast");
        preventPageZoom();
        readStorage();
        hydrateSidebarMode();
        hydrateSignalSidebarMode();
        hydrateFields();
        renderDynamicStopTags();
        renderMatrix();
        renderTrialMatrix();
        bindEvents();
        bindDynamicStopTags();
        recalc();
        renderRecords();
        renderTagManager();
        renderSignalRecords();
        renderHomeAccount();
        window.setInterval(function () {
          if (pruneExpiredSignals(true)) renderSignalRecords();
        }, 60000);
        showSystemHome();
      }

      function preventPageZoom() {
        var lastTouchEnd = 0;
        document.addEventListener("gesturestart", function (event) {
          event.preventDefault();
        });
        document.addEventListener("touchmove", function (event) {
          if (event.touches && event.touches.length > 1) {
            event.preventDefault();
          }
        }, { passive: false });
        document.addEventListener("touchend", function (event) {
          var now = Date.now();
          if (now - lastTouchEnd <= 300) {
            event.preventDefault();
          }
          lastTouchEnd = now;
        }, { passive: false });
      }

      init();
    })(appConfig);
