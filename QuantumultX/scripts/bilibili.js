/*
 * Bilibili Plus Lite v2 — Quantumult X response script
 *
 * Based on the JSON filtering behavior in asjdf/bilibili-plus:
 * https://github.com/asjdf/bilibili-plus
 * Original project license: GPL-3.0 (see LICENSE)
 *
 * This version is deliberately self-contained, with no Protobuf decoding,
 * dynamic script imports, or extra network requests.
 * The navigation is tailored to the user's compact UI:
 * top tabs: 直播 / 推荐 / 热门 / 影视
 * bottom: 首页 / 关注 / 我的
 * top-right shortcut icons: none
 * If a response shape is unfamiliar, it is passed through unchanged.
 */

"use strict";

(function () {
    const url = (typeof $request !== "undefined" && $request.url) || "";
    const raw = (typeof $response !== "undefined" && $response.body) || "";

    if (typeof raw !== "string" || raw.length === 0) {
        $done({});
        return;
    }

    const requiredHomeTabs = ["直播", "推荐", "热门", "影视"];
    const requiredBottomTabs = ["首页", "关注", "我的"];

    // Two URL forms are in use. Previous edition matched /tab/v2 in the
    // rewrite rule but not here, so navigation was silently passed through.
    const isTabURL = /^https?:\/\/app\.bilibili\.com\/x\/resource\/show\/tab(?:\/v2)?(?:\?|$)/.test(url);

    function label(entry) {
        return entry && typeof entry.name === "string" ? entry.name.trim() : "";
    }

    function bottomKind(entry) {
        if (!entry || typeof entry !== "object") return "";
        const name = label(entry);
        const id = Number(entry.id);
        const uri = typeof entry.uri === "string" ? entry.uri : "";
        if (id === 177 || name === "首页" || /^bilibili:\/\/main\/home\//.test(uri)) return "首页";
        if (id === 179 || name === "关注" || name === "动态" || /^bilibili:\/\/following\/home\//.test(uri)) return "关注";
        if (id === 181 || name === "我的" || /^bilibili:\/\/user_center\//.test(uri)) return "我的";
        return "";
    }
    const keepMineIds = new Set([
        396, 397, 398, 399, 171, 172, 534, 8, 4, 428, 352, 1,
        405, 402, 404, 544, 407, 410, 622, 425, 426, 427, 430, 431, 432
    ]);

    try {
        const response = JSON.parse(raw);
        const data = response && response.data;
        let changed = false;

        // 首页信息流：仅删除明确标记为广告的条目，避免误删新版卡片。
        if (/^https:\/\/app\.bilibili\.com\/x\/v2\/feed\/index\?/.test(url)) {
            if (data && Array.isArray(data.items)) {
                const result = [];
                for (const item of data.items) {
                    if (!item || typeof item !== "object") {
                        result.push(item);
                        continue;
                    }
                    if (Array.isArray(item.banner_item)) {
                        const banners = item.banner_item.filter((banner) => !(
                            banner && (
                                banner.type === "ad" ||
                                banner.is_ad === true ||
                                (banner.static_banner && banner.static_banner.is_ad_loc === true)
                            )
                        ));
                        if (banners.length !== item.banner_item.length) {
                            item.banner_item = banners;
                            changed = true;
                        }
                        if (banners.length > 0) result.push(item);
                        else changed = true;
                        continue;
                    }
                    const goto = typeof item.card_goto === "string" ? item.card_goto : "";
                    const isAd = (item.ad_info != null) || item.is_ad === true || /^ad(?:_|$)/i.test(goto);
                    if (isAd) changed = true;
                    else result.push(item);
                }
                if (changed) data.items = result;
            }
        }

        // 开屏广告：沿用原项目的无效时间段做法。
        else if (/^https?:\/\/app\.bilibili\.com\/x\/v2\/splash\/list(?:\?|$)/.test(url)) {
            if (data && Array.isArray(data.list)) {
                data.max_time = 0;
                data.min_interval = 31536000;
                data.pull_interval = 31536000;
                for (const item of data.list) {
                    if (!item || typeof item !== "object") continue;
                    item.duration = 0;
                    item.begin_time = 1915027200;
                    item.end_time = 1924272000;
                }
                changed = true;
            }
        }

        // 首页导航：同时支持 /x/resource/show/tab 和 /x/resource/show/tab/v2。
        // 保留搜索框与头像；移除顶部游戏、消息等快捷图标。
        else if (isTabURL) {
            if (data && typeof data === "object") {
                if (Array.isArray(data.tab) && data.tab.length > 0) {
                    const byName = new Map();
                    for (const entry of data.tab) {
                        const name = label(entry);
                        if (entry && typeof entry === "object" && requiredHomeTabs.includes(name) && !byName.has(name)) {
                            byName.set(name, entry);
                        }
                    }

                    // Some accounts no longer receive a live tab in the response.
                    // Restore it using the known server-side tab schema, rather than
                    // redirecting a different tab or adding a client-side widget.
                    if (!byName.has("直播") && byName.has("推荐") && byName.has("热门")) {
                        const isV2 = /\/tab\/v2(?:\?|$)/.test(url);
                        byName.set("直播", {
                            id: isV2 ? 731 : 39,
                            name: "直播",
                            uri: "bilibili://live/home",
                            tab_id: "直播tab",
                            pos: 1
                        });
                    }

                    // For an unfamiliar API response do not destroy navigation.
                    if (byName.has("推荐") && byName.size >= 2) {
                        const next = requiredHomeTabs.filter((name) => byName.has(name)).map((name, index) => {
                            const entry = { ...byName.get(name), pos: index + 1 };
                            if (name === "推荐") entry.default_selected = 1;
                            else if (Object.prototype.hasOwnProperty.call(entry, "default_selected")) entry.default_selected = 0;
                            return entry;
                        });
                        if (JSON.stringify(next) !== JSON.stringify(data.tab)) {
                            data.tab = next;
                            changed = true;
                        }
                    }
                }

                if (Array.isArray(data.top) && data.top.length > 0) {
                    data.top = [];
                    changed = true;
                }

                if (Array.isArray(data.bottom) && data.bottom.length > 0) {
                    const byKind = new Map();
                    for (const entry of data.bottom) {
                        const kind = bottomKind(entry);
                        if (kind && !byKind.has(kind)) byKind.set(kind, entry);
                    }
                    // Avoid an unusable tab bar if the App changes its JSON schema.
                    if (byKind.has("首页") && byKind.has("我的") && byKind.size >= 2) {
                        const next = requiredBottomTabs.filter((name) => byKind.has(name)).map((name, index) => ({
                            ...byKind.get(name),
                            name,
                            pos: index + 1
                        }));
                        if (JSON.stringify(next) !== JSON.stringify(data.bottom)) {
                            data.bottom = next;
                            changed = true;
                        }
                    }
                }
            }
        }

        // “我的”：未出现 sections_v2 时不改写响应，兼容新版字段变化。
        else if (/^https?:\/\/app\.bilibili\.com\/x\/v2\/account\/mine(?:\?|$)/.test(url)) {
            if (data && Array.isArray(data.sections_v2)) {
                for (const section of data.sections_v2) {
                    if (!section || !Array.isArray(section.items)) continue;
                    for (const item of section.items) {
                        if (item && item.id === 622) {
                            item.title = "会员购";
                            item.uri = "bilibili://mall/home";
                            changed = true;
                        }
                    }
                    const next = section.items.filter((entry) => entry && keepMineIds.has(entry.id));
                    if (next.length !== section.items.length) { section.items = next; changed = true; }
                    if (section.button !== undefined) { section.button = {}; changed = true; }
                    for (const key of ["be_up_title", "tip_icon", "tip_title"]) {
                        if (Object.prototype.hasOwnProperty.call(section, key)) {
                            delete section[key];
                            changed = true;
                        }
                    }
                }
            }
        }

        // 直播间页广告。
        else if (/^https?:\/\/api\.live\.bilibili\.com\/xlive\/app-room\/v1\/index\/getInfoByRoom(?:\?|$)/.test(url)) {
            if (data && data.activity_banner_info != null) {
                data.activity_banner_info = null;
                changed = true;
            }
        }

        // 旧版动态流。避免 64 位动态 ID 被 JSON.parse / stringify 损坏。
        else if (/^https?:\/\/api\.vc\.bilibili\.com\/dynamic_svr\/v1\/dynamic_svr\/dynamic_(?:history|new)\?/.test(url)) {
            if (data && Array.isArray(data.cards)) {
                const next = [];
                for (const card of data.cards) {
                    if (!card || typeof card !== "object") { next.push(card); continue; }
                    const isAd = typeof card.card === "string" && card.card.includes('"ad_ctx"');
                    if (isAd) { changed = true; continue; }
                    // 仅在有权威字符串字段时替换可能超出 JS 安全整数范围的数值。
                    if (card.desc && typeof card.desc === "object") {
                        for (const key of ["dynamic_id", "pre_dy_id", "orig_dy_id", "rid"]) {
                            if (typeof card.desc[key + "_str"] === "string") {
                                card.desc[key] = card.desc[key + "_str"];
                            }
                        }
                    }
                    next.push(card);
                }
                // 动态卡片的其他大整数仍可能存在；如无广告则不重编码。
                if (changed) data.cards = next;
            }
        }

        $done(changed ? { body: JSON.stringify(response) } : {});
    } catch (error) {
        // 任意解析或字段异常，直接返回未经修改的原响应。
        console.log("[Bilibili Plus Lite] pass-through: " + String(error));
        $done({});
    }
})();