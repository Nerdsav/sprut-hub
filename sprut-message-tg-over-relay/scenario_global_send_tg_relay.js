// ============================================================
// ГЛОБАЛЬНЫЙ СЦЕНАРИЙ: Отправка в TG через релей (см сервис notify-service)
// Универсальный — каждый релей со своими настройками
// ============================================================

// ---------- РЕЛЕИ ----------
// Каждый релей описывается отдельно:
//   url        — базовый URL сервиса (без /send)
//   api_key    — X-API-Key для этого сервиса
//   channels   — массив channel_id ИЛИ строка "id1,id2,id3"
//   tag        — добавляется в конец сообщения при отправке через этот релей
//
// Порядок важен: сначала пробуем первый, при полной неудаче — следующий.
const RELAYS = [
    {
        url:      "http://xx.xx.xx.xx.18:8448",
        api_key:  "********",
        channels: "telegram_my_notify",
        tag:      "\n[channel1]"
    },
    {
        url:      "https://yy.yyy.yy.yy:8443",
        api_key:  "ВСТАВЬТЕ_КЛЮЧ_РЕЗЕРВНОГО_СЕРВИСА",
        channels: "telegram_my_notify",
        tag:      "\n[shannel2]"
    }
];

const MAX_RETRIES    = 5;
const RETRY_DELAY_MS = 1000;

// ---------- УТИЛИТЫ ----------

function jsonEscape(s) {
    return String(s)
        .replace(/\\/g, "\\\\")
        .replace(/"/g,  '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}

function isOk(response) {
    var s = String(response);
    if (s.indexOf("200 OK") === -1) return false;
    if (s.indexOf('"status": "success"') === -1 &&
        s.indexOf('"status":"success"')   === -1) return false;
    return true;
}

function sleep(ms) {
    try { java.lang.Thread.sleep(ms); } catch (e) {}
}

// Нормализуем channels: строка "a,b,c" → ["a","b","c"]; массив — как есть
function normalizeChannels(ch) {
    if (!ch) return [];
    if (Object.prototype.toString.call(ch) === "[object Array]") {
        return ch;
    }
    var parts = String(ch).split(",");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
        var s = parts[i].replace(/^\s+|\s+$/g, "");   // trim
        if (s) out.push(s);
    }
    return out;
}

// Один POST на конкретный релей + конкретный channel_id
function postOne(relay, channelId, message) {
    var body = "{"
             + "\"channel_id\":\"" + jsonEscape(channelId) + "\","
             + "\"message\":\""    + jsonEscape(message)   + "\","
             + "\"parse_mode\":\"Markdown\","
             + "\"silent\":false"
             + "}";

    return HttpClient.POST(relay.url)
        .path("send")
        .header("X-API-Key", relay.api_key)
        .header("Content-Type", "application/json")
        .body(body)
        .send();
}

// ---------- ОТПРАВКА ----------
function sendNotifyToTG(text) {
    if (!Array.isArray(text)) text = [text];

    var sent = false;

    for (var r = 0; r < RELAYS.length && !sent; r++) {
        var relay       = RELAYS[r];
        var relaySent   = true;             // по умолчанию считаем, что через этот релей всё ок
        var channels    = normalizeChannels(relay.channels);
        var message     = text.join("\n") + relay.tag;

        if (channels.length === 0) {
            log.warn("[sendNotifyToTG] relay=" + relay.url + " — нет каналов, пропускаем");
            continue;
        }

        // ---- Для каждого канала: retry × MAX_RETRIES ----
        for (var c = 0; c < channels.length; c++) {
            var channelId    = channels[c];
            var channelSent  = false;

            for (var attempt = 1; attempt <= MAX_RETRIES && !channelSent; attempt++) {
                try {
                    var response = postOne(relay, channelId, message);
                    var respStr  = String(response).slice(0, 200);

                    if (isOk(response)) {
                        log.info("[sendNotifyToTG] OK relay=" + relay.url
                                 + " channel=" + channelId
                                 + " attempt=" + attempt);
                        channelSent = true;
                    } else {
                        log.warn("[sendNotifyToTG] BAD relay=" + relay.url
                                 + " channel=" + channelId
                                 + " attempt=" + attempt
                                 + " response=" + respStr);
                    }
                } catch (e) {
                    log.warn("[sendNotifyToTG] THREW relay=" + relay.url
                             + " channel=" + channelId
                             + " attempt=" + attempt
                             + " error=" + e.message);
                }

                if (!channelSent && attempt < MAX_RETRIES) sleep(RETRY_DELAY_MS);
            }

            if (!channelSent) {
                // Один канал не ушёл — считаем весь релей проваленным,
                // переходим к следующему релею (фолбэк)
                relaySent = false;
                log.warn("[sendNotifyToTG] channel=" + channelId
                         + " — не ушёл через relay=" + relay.url
                         + ", переходим к следующему релею");
                break;
            }
        }

        if (relaySent) {
            sent = true;
        }
    }

    if (!sent) {
        log.error("[sendNotifyToTG] FAILED all relays");
    }
}
