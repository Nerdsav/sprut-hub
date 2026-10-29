// ============================================================
// СЦЕНАРИЙ: Мониторинг устройств не в сети
// Версия: 1.5
// ============================================================

info = {
    name: "Проверка устройств не в сети",
    description: "Раз в N часов собирает список устройств не в сети и отправляет в Telegram",
    version: "1.5",
    author: "A.Soroko",
    email: "nerdsav@gmail.com",
    onStart: true,

    sourceServices: [],
    sourceCharacteristics: [],

    options: {
        periodHours: {
            name: { ru: "Период проверки (часы)", en: "Check period (hours)" },
            desc: { ru: "Как часто проверять устройства (в часах)", en: "How often to check devices (hours)" },
            type: "Integer",
            value: 24,
            formType: "list",
            values: [
                { value: 1, key: "H1", name: { ru: "1 час", en: "1 hour" } },
                { value: 6, key: "H6", name: { ru: "6 часов", en: "6 hours" } },
                { value: 12, key: "H12", name: { ru: "12 часов", en: "12 hours" } },
                { value: 24, key: "H24", name: { ru: "24 часа", en: "24 hours" } }
            ]
        }
    },

    variables: {
        cronTask: undefined
    }
};

// ============================================================
// НАСТРОЙКА ИСКЛЮЧЕНИЙ
// ============================================================
const DEV_EXCLUDE = [
    // Пример: исключить конкретное устройство по ID (число из сообщения)
    // { room: "Новая комната", device: "Выключатель", device_id: "19" },
    
    // Пример: исключить ВСЕ устройства в комнате
    // { room: "Новая комната", device: "*", device_id: "" },
    
    // Пример: исключить все устройства с именем "Выключатель" в комнате "Новая комната"
    // { room: "Новая комната", device: "Выключатель", device_id: "" }
];

function trigger(source, value, variables, options, context) {
    const isHubStartup = context && context.toString().indexOf("HUB[OnStart]") >= 0;

    setupCron(variables, options);

    if (!isHubStartup) {
        runCheck(options);
    }
}

function setupCron(variables, options) {
    if (variables.cronTask) {
        variables.cronTask.clear();
        variables.cronTask = undefined;
    }

    const hours = options.periodHours || 24;
    let cronExpr;
    
    if (hours === 24) {
        cronExpr = "0 0 0 * * *"; // В полночь
    } else if (hours === 1) {
        cronExpr = "0 0 * * * *"; // Каждый час
    } else {
        cronExpr = "0 0 */" + hours + " * * *";
    }

    variables.cronTask = Cron.schedule(cronExpr, function () {
        runCheck(options);
    });

    logInfo("Расписание проверки устройств настроено: каждые " + hours + " ч. (" + cronExpr + ")", null, true);
}

function runCheck(options) {
    const offlineDevices = [];

    try {
        const accessories = Hub.getAccessories();

        accessories.forEach(function (acc) {
            try {
                let roomName = "Без комнаты";
                try {
                    const room = acc.getRoom();
                    if (room) roomName = room.getName();
                } catch (e) {}

                const accName = acc.getName();
                const deviceId = acc.getUUID ? String(acc.getUUID()) : ""; 

                if (isExcluded(roomName, accName, deviceId)) {
                    return;
                }

                const infoService = acc.getService(HS.AccessoryInformation);
                if (!infoService) return;

                const onlineChar = infoService.getCharacteristic(HC.C_Online);
                if (!onlineChar) return;

                const isOnline = onlineChar.getValue();

                if (isOnline === false) {
                    offlineDevices.push({
                        room: roomName,
                        name: accName,
                        id: deviceId
                    });
                }
            } catch (e) {
                console.warn("Ошибка проверки аксессуара: " + e.toString());
            }
        });

    } catch (e) {
        logError("Не удалось получить список аксессуаров: " + e.toString(), null, false);
        return;
    }

    offlineDevices.sort(function(a, b) {
        if (a.room !== b.room) {
            return a.room.localeCompare(b.room);
        }
        return a.name.localeCompare(b.name);
    });

    let message;
    if (offlineDevices.length === 0) {
        message = "✅ Все устройства в сети.";
    } else {
        message = "⚠️ Проверка устройств: Устройства не в сети (" + offlineDevices.length + "):\n---\n";
        
        for (let i = 0; i < offlineDevices.length; i++) {
            const dev = offlineDevices[i];
            const idText = dev.id ? " (ID: " + dev.id + ")" : "";
            message += (i + 1) + ") " + dev.room + " → " + dev.name + idText + "\n";
        }
        message += "---";
    }

    sendToGlobalNotify(message);
}

function isExcluded(room, device, id) {
    for (let i = 0; i < DEV_EXCLUDE.length; i++) {
        const ex = DEV_EXCLUDE[i];
        
        if (ex.device_id && String(ex.device_id) === String(id)) {
            return true;
        }

        if (ex.room === room) {
            if (ex.device === "*") {
                return true;
            }
            if (ex.device === device) {
                return true;
            }
        }
    }
    return false;
}

function sendToGlobalNotify(text) {
    try {
        if (typeof global !== 'undefined' && typeof global.sendNotifyToTG === 'function') {
            global.sendNotifyToTG(text);
            logInfo("Сообщение передано в global.sendNotifyToTG", null, true);
        } else {
            logError("Функция global.sendNotifyToTG не найдена!", null, false);
        }
    } catch (e) {
        logError("Ошибка при вызове global.sendNotifyToTG: " + e.toString(), null, false);
    }
}

function logInfo(text, source, show) {
    if (show) console.info(text);
}

function logError(text, source, isHubStartup) {
    console.error(text);
}

// Обёртка для ручного запуска из блочного сценария
function runNow() {
    runCheck(info.options);
}
