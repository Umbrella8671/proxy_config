/***

[task_local]
event-interaction https://raw.githubusercontent.com/.../streaming-ui-check.js, tag=流媒体解锁检测, img-url=play.tv.fill.system

@Description: 流媒体 & AI 服务解锁检测 (Netflix, YouTube, Spotify, ChatGPT, Claude, Gemini, Bahamut, Prime Video, TikTok)
@Update: 2026-07-04

逻辑 1:1 翻译自 clash-verge-rev Rust 源码

***/

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const ARROW = ' ➟ '
const TIMEOUT = 5000

const opts = { policy: $environment.params }
const optsNoRedirect = { policy: $environment.params, redirection: false }

// ─── 结果容器 ───
const result = {
    Netflix: '',
    YouTube: '',
    Spotify: '',
    ChatGPTiOS: '',
    ChatGPTWeb: '',
    Claude: '',
    Gemini: '',
    PrimeVideo: '',
    TikTok: '',
}

// ═══════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════

function countryCodeToFlag(code) {
    if (!code) return ''
    code = String(code).toUpperCase()
    if (code === 'UK') code = 'GB'
    if (!/^[A-Z]{2}$/.test(code)) return ''
    return String.fromCodePoint(code.charCodeAt(0) - 65 + 0x1F1E6)
        + String.fromCodePoint(code.charCodeAt(1) - 65 + 0x1F1E6)
}

function regionTag(code) {
    code = String(code || '').toUpperCase()
    const flag = countryCodeToFlag(code)
    return flag ? '⟦' + flag + code + '⟧' : (code ? '⟦' + code + '⟧' : '')
}

function statusCode(resp) {
    return resp.statusCode || resp.status || 0
}

function fetchWithTimeout(option) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject('Timeout'), option.timeout || TIMEOUT)
        $task.fetch(option).then(resp => {
            clearTimeout(timer)
            resolve(resp)
        }, err => {
            clearTimeout(timer)
            reject(err)
        })
    })
}

/** 解析 Cloudflare cdn-cgi/trace 中的 loc=XX */
function getTraceRegion(traceUrl) {
    return fetchWithTimeout({
        url: traceUrl,
        opts: opts,
        timeout: TIMEOUT,
        headers: { 'User-Agent': UA },
    }).then(resp => {
        const m = (resp.body || '').match(/loc=([A-Z]{2})/i)
        return m ? m[1].toUpperCase() : ''
    }).catch(() => '')
}

function line(label, status) {
    return '<b>' + label + ': </b>' + status
}

function withRegion(region) {
    const tag = regionTag(region)
    return tag ? ARROW + tag : ''
}

// ═══════════════════════════════════════════════════
//  Netflix  (CDN fast-path ∥ Title fallback)
// ═══════════════════════════════════════════════════

function testNetflix() {
    // CDN (fast.com) 和 Title 并行跑，CDN 先出结果就用 CDN
    const cdnPromise = fetchWithTimeout({
        url: 'https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=5',
        opts: opts,
        timeout: 3000,
        headers: { 'User-Agent': UA },
    }).then(resp => {
        if (statusCode(resp) === 403) return { status: 'banned' }
        try {
            const data = JSON.parse(resp.body)
            if (data.targets && data.targets.length > 0 && data.targets[0].location) {
                return { status: 'ok', region: data.targets[0].location.country || '' }
            }
        } catch (e) { /* ignore */ }
        return { status: 'unknown' }
    }).catch(() => ({ status: 'unknown' }))

    // Title 检测 (与旧脚本一致，用 x-originating-url 提取区域)
    const titlePromise = fetchWithTimeout({
        url: 'https://www.netflix.com/title/81280792',
        opts: opts,
        timeout: 7000,
        headers: { 'User-Agent': UA },
    }).then(resp => {
        const code = statusCode(resp)
        const headers = resp.headers || {}
        return { code, headers }
    }).catch(() => ({ code: 0, headers: {} }))

    return Promise.all([cdnPromise, titlePromise]).then(results => {
        const cdn = results[0]
        const title = results[1]

        // CDN 给出明确结果
        if (cdn.status === 'banned') {
            result.Netflix = line('Netflix', 'IP 被封禁 🚫')
            return
        }
        if (cdn.status === 'ok') {
            result.Netflix = line('Netflix', '完整支持' + withRegion(cdn.region) + ' 🎉')
            return
        }

        // Title 检测
        if (title.code === 403) {
            result.Netflix = line('Netflix', '未支持 🚫')
            return
        }
        if (title.code === 404) {
            result.Netflix = line('Netflix', '仅自制剧集 ⚠️')
            return
        }
        if (title.code === 200 || title.code === 301 || title.code === 302) {
            let region = ''
            const xurl = title.headers['X-Originating-URL'] || title.headers['x-originating-url'] || ''
            if (xurl) {
                const parts = xurl.split('/')
                if (parts.length >= 4) {
                    region = (parts[3].split('-')[0] || '').toUpperCase()
                }
            }
            if (!region || region === 'TITLE') region = 'US'
            result.Netflix = line('Netflix', '完整支持' + withRegion(region) + ' 🎉')
            return
        }

        if (title.code === 0) {
            result.Netflix = line('Netflix', '检测超时 🚦')
        } else {
            result.Netflix = line('Netflix', '检测失败 ❗️')
        }
    }).catch(() => {
        result.Netflix = line('Netflix', '检测失败 ❗️')
    })
}

// ═══════════════════════════════════════════════════
//  YouTube Premium  (4 regex patterns)
// ═══════════════════════════════════════════════════

function testYouTubePremium() {
    return fetchWithTimeout({
        url: 'https://www.youtube.com/premium',
        opts: opts,
        timeout: 7000,
        headers: { 'User-Agent': UA },
    }).then(resp => {
        const code = statusCode(resp)
        const body = resp.body || ''
        const bodyLower = body.toLowerCase()

        if (code !== 200) {
            result.YouTube = line('YouTube Premium', '检测失败 ❗️')
            return
        }

        // 区域提取 (4 种 regex，按优先级)
        let region = ''
        const patterns = [
            /id=['"]country-code['"][^>]*>\s*([A-Za-z]{2,3})\s*</,
            /"GL"\s*:\s*"([A-Za-z]{2})"/,
            /"countryCode"\s*:\s*"([A-Za-z]{2})"/,
            /"country_code"\s*:\s*"([A-Za-z]{2})"/,
        ]
        for (let i = 0; i < patterns.length; i++) {
            const m = body.match(patterns[i])
            if (m && m[1]) { region = m[1].toUpperCase(); break }
        }

        // 如果 body 里没有匹配到，尝试用 google.cn 判断 CN
        if (!region && bodyLower.indexOf('www.google.cn') !== -1) region = 'CN'

        // 状态判断
        if (bodyLower.indexOf('premium is not available in your country') !== -1
            || bodyLower.indexOf('premium is not available in your region') !== -1) {
            result.YouTube = line('YouTube Premium', '未支持 🚫')
            return
        }

        // 200 且没说不可用 → 支持
        result.YouTube = line('YouTube Premium', '支持' + withRegion(region) + ' 🎉')
    }).catch(() => {
        result.YouTube = line('YouTube Premium', '检测超时 🚦')
    })
}

// ═══════════════════════════════════════════════════
//  Spotify  (country-selector API, no redirect)
// ═══════════════════════════════════════════════════

function testSpotify() {
    return fetchWithTimeout({
        url: 'https://www.spotify.com/api/content/v1/country-selector?platform=web&format=json',
        opts: opts,
        timeout: TIMEOUT,
        headers: { 'User-Agent': UA },
    }).then(resp => {
        const code = statusCode(resp)
        const body = resp.body || ''
        const bodyLower = body.toLowerCase()

        if (code === 403 || code === 451) {
            result.Spotify = line('Spotify', '未支持 🚫')
            return
        }
        if (code < 200 || code >= 300) {
            result.Spotify = line('Spotify', '检测失败 ❗️')
            return
        }
        if (bodyLower.indexOf('not available in your country') !== -1) {
            result.Spotify = line('Spotify', '未支持 🚫')
            return
        }

        // 区域提取：从 body 中解析 countryCode
        let region = ''
        const m = body.match(/"countryCode"\s*:\s*"([A-Z]+)"/i)
        if (m && m[1]) region = m[1].toUpperCase()

        result.Spotify = line('Spotify', '支持' + withRegion(region) + ' 🎉')
    }).catch(() => {
        result.Spotify = line('Spotify', '检测超时 🚦')
    })
}

// ═══════════════════════════════════════════════════
//  ChatGPT  (2 items: iOS + Web)
// ═══════════════════════════════════════════════════

function testChatGPT() {
    return getTraceRegion('https://chat.openai.com/cdn-cgi/trace').then(region => {
        const regionStr = region ? ARROW + regionTag(region) : ''

        const iosPromise = fetchWithTimeout({
            url: 'https://ios.chat.openai.com/',
            opts: opts,
            timeout: TIMEOUT,
            headers: { 'User-Agent': UA },
        }).then(resp => {
            const body = (resp.body || '').toLowerCase()
            if (body.indexOf('you may be connected to a disallowed isp') !== -1) {
                result.ChatGPTiOS = line('ChatGPT iOS', 'ISP 受限 ⚠️' + regionStr)
            } else if (body.indexOf('request is not allowed. please try again later.') !== -1) {
                result.ChatGPTiOS = line('ChatGPT iOS', '支持' + regionStr + '🎉')
            } else if (body.indexOf('sorry, you have been blocked') !== -1) {
                result.ChatGPTiOS = line('ChatGPT iOS', '已封锁 🚫')
            } else {
                result.ChatGPTiOS = line('ChatGPT iOS', '检测失败 ❗️')
            }
        }).catch(() => {
            result.ChatGPTiOS = line('ChatGPT iOS', '检测超时 🚦')
        })

        const webPromise = fetchWithTimeout({
            url: 'https://api.openai.com/compliance/cookie_requirements',
            opts: opts,
            timeout: TIMEOUT,
            headers: { 'User-Agent': UA },
        }).then(resp => {
            const body = (resp.body || '').toLowerCase()
            if (body.indexOf('unsupported_country') !== -1) {
                result.ChatGPTWeb = line('ChatGPT Web', '未支持 🚫' + regionStr)
            } else {
                result.ChatGPTWeb = line('ChatGPT Web', '支持' + regionStr + '🎉')
            }
        }).catch(() => {
            result.ChatGPTWeb = line('ChatGPT Web', '检测超时 🚦')
        })

        return Promise.all([iosPromise, webPromise])
    })
}

// ═══════════════════════════════════════════════════
//  Claude  (trace + blocked list)
// ═══════════════════════════════════════════════════

const CLAUDE_BLOCKED = ['AF', 'BY', 'CN', 'CU', 'HK', 'IR', 'KP', 'MO', 'RU', 'SY']

function testClaude() {
    return getTraceRegion('https://claude.ai/cdn-cgi/trace').then(region => {
        if (!region) {
            result.Claude = line('Claude', '检测失败 ❗️')
        } else if (CLAUDE_BLOCKED.indexOf(region) !== -1) {
            result.Claude = line('Claude', '未支持 🚫')
        } else {
            result.Claude = line('Claude', '支持' + withRegion(region) + ' 🎉')
        }
    })
}

// ═══════════════════════════════════════════════════
//  Gemini  (body marker ,2,1,200," + alpha-3 code)
// ═══════════════════════════════════════════════════

const GEMINI_BLOCKED = ['CHN', 'RUS', 'BLR', 'CUB', 'IRN', 'PRK', 'SYR', 'HKG', 'MAC']

// ISO 3166 alpha-3 → alpha-2 映射 (Gemini 返回 alpha-3)
const A3_TO_A2 = {
    AFG: 'AF', ALB: 'AL', DZA: 'DZ', AND: 'AD', AGO: 'AO', ATG: 'AG', ARG: 'AR', ARM: 'AM',
    AUS: 'AU', AUT: 'AT', AZE: 'AZ', BHS: 'BS', BHR: 'BH', BGD: 'BD', BRB: 'BB', BLR: 'BY',
    BEL: 'BE', BLZ: 'BZ', BEN: 'BJ', BTN: 'BT', BOL: 'BO', BIH: 'BA', BWA: 'BW', BRA: 'BR',
    BRN: 'BN', BGR: 'BG', BFA: 'BF', BDI: 'BI', KHM: 'KH', CMR: 'CM', CAN: 'CA', CPV: 'CV',
    CAF: 'CF', TCD: 'TD', CHL: 'CL', CHN: 'CN', COL: 'CO', COM: 'KM', COG: 'CG', COD: 'CD',
    CRI: 'CR', CIV: 'CI', HRV: 'HR', CUB: 'CU', CYP: 'CY', CZE: 'CZ', DNK: 'DK', DJI: 'DJ',
    DMA: 'DM', DOM: 'DO', ECU: 'EC', EGY: 'EG', SLV: 'SV', GNQ: 'GQ', ERI: 'ER', EST: 'EE',
    SWZ: 'SZ', ETH: 'ET', FJI: 'FJ', FIN: 'FI', FRA: 'FR', GAB: 'GA', GMB: 'GM', GEO: 'GE',
    DEU: 'DE', GHA: 'GH', GRC: 'GR', GRD: 'GD', GTM: 'GT', GIN: 'GN', GNB: 'GW', GUY: 'GY',
    HTI: 'HT', HND: 'HN', HUN: 'HU', ISL: 'IS', IND: 'IN', IDN: 'ID', IRN: 'IR', IRQ: 'IQ',
    IRL: 'IE', ISR: 'IL', ITA: 'IT', JAM: 'JM', JPN: 'JP', JOR: 'JO', KAZ: 'KZ', KEN: 'KE',
    KIR: 'KI', PRK: 'KP', KOR: 'KR', KWT: 'KW', KGZ: 'KG', LAO: 'LA', LVA: 'LV', LBN: 'LB',
    LSO: 'LS', LBR: 'LR', LBY: 'LY', LIE: 'LI', LTU: 'LT', LUX: 'LU', MDG: 'MG', MWI: 'MW',
    MYS: 'MY', MDV: 'MV', MLI: 'ML', MLT: 'MT', MHL: 'MH', MRT: 'MR', MUS: 'MU', MEX: 'MX',
    FSM: 'FM', MDA: 'MD', MCO: 'MC', MNG: 'MN', MNE: 'ME', MAR: 'MA', MOZ: 'MZ', MMR: 'MM',
    NAM: 'NA', NRU: 'NR', NPL: 'NP', NLD: 'NL', NZL: 'NZ', NIC: 'NI', NER: 'NE', NGA: 'NG',
    MKD: 'MK', NOR: 'NO', OMN: 'OM', PAK: 'PK', PLW: 'PW', PAN: 'PA', PNG: 'PG', PRY: 'PY',
    PER: 'PE', PHL: 'PH', POL: 'PL', PRT: 'PT', QAT: 'QA', ROU: 'RO', RUS: 'RU', RWA: 'RW',
    KNA: 'KN', LCA: 'LC', VCT: 'VC', WSM: 'WS', SMR: 'SM', STP: 'ST', SAU: 'SA', SEN: 'SN',
    SRB: 'RS', SYC: 'SC', SLE: 'SL', SGP: 'SG', SVK: 'SK', SVN: 'SI', SLB: 'SB', SOM: 'SO',
    ZAF: 'ZA', ESP: 'ES', LKA: 'LK', SDN: 'SD', SUR: 'SR', SWE: 'SE', CHE: 'CH', SYR: 'SY',
    TWN: 'TW', TJK: 'TJ', TZA: 'TZ', THA: 'TH', TLS: 'TL', TGO: 'TG', TON: 'TO', TTO: 'TT',
    TUN: 'TN', TUR: 'TR', TKM: 'TM', TUV: 'TV', UGA: 'UG', UKR: 'UA', ARE: 'AE', GBR: 'GB',
    USA: 'US', URY: 'UY', UZB: 'UZ', VUT: 'VU', VEN: 'VE', VNM: 'VN', YEM: 'YE', ZMB: 'ZM',
    ZWE: 'ZW', HKG: 'HK', MAC: 'MO', PSE: 'PS', XKX: 'XK',
}

function alpha3toAlpha2(a3) {
    return A3_TO_A2[a3] || a3
}

function testGemini() {
    return fetchWithTimeout({
        url: 'https://gemini.google.com',
        opts: opts,
        timeout: TIMEOUT,
        headers: { 'User-Agent': UA },
    }).then(resp => {
        const body = resp.body || ''
        const marker = ',2,1,200,"'
        const idx = body.indexOf(marker)

        if (idx !== -1) {
            const code = body.substring(idx + marker.length, idx + marker.length + 3)
            if (/^[A-Z]{3}$/.test(code)) {
                if (GEMINI_BLOCKED.indexOf(code) !== -1) {
                    result.Gemini = line('Gemini', '未支持 🚫')
                } else {
                    const a2 = alpha3toAlpha2(code)
                    result.Gemini = line('Gemini', '支持' + withRegion(a2) + ' 🎉')
                }
                return
            }
        }
        result.Gemini = line('Gemini', '检测失败 ❗️')
    }).catch(() => {
        result.Gemini = line('Gemini', '检测超时 🚦')
    })
}



// ═══════════════════════════════════════════════════
//  Prime Video  (currentTerritory)
// ═══════════════════════════════════════════════════

function testPrimeVideo() {
    return fetchWithTimeout({
        url: 'https://www.primevideo.com',
        opts: opts,
        timeout: 10000,
        headers: { 'User-Agent': UA },
    }).then(resp => {
        const body = resp.body || ''

        if (body.indexOf('isServiceRestricted') !== -1) {
            result.PrimeVideo = line('Prime Video', '未支持 🚫')
            return
        }

        const m = body.match(/"currentTerritory"\s*:\s*"([^"]+)"/)
        if (m && m[1]) {
            const region = m[1].toUpperCase()
            result.PrimeVideo = line('Prime Video', '支持' + withRegion(region) + ' 🎉')
        } else {
            result.PrimeVideo = line('Prime Video', '检测失败 ❗️')
        }
    }).catch(() => {
        result.PrimeVideo = line('Prime Video', '检测超时 🚦')
    })
}

// ═══════════════════════════════════════════════════
//  TikTok  (trace + fallback to main page)
// ═══════════════════════════════════════════════════

function testTikTok() {
    let tiktokStatus = 'Failed'
    let tiktokRegion = ''

    return fetchWithTimeout({
        url: 'https://www.tiktok.com/cdn-cgi/trace',
        opts: opts,
        timeout: TIMEOUT,
        headers: { 'User-Agent': UA },
    }).then(resp => {
        const code = statusCode(resp)
        const body = resp.body || ''
        const parsed = parseTikTokResponse(code, body)
        tiktokStatus = parsed.status
        tiktokRegion = parsed.region

        // 从 trace 中也提取 loc
        if (!tiktokRegion) {
            const locMatch = body.match(/loc=([A-Z]{2})/i)
            if (locMatch) tiktokRegion = locMatch[1].toUpperCase()
        }
    }).catch(() => {
        // trace 失败，后续 fallback
    }).then(() => {
        if (tiktokRegion && tiktokStatus !== 'Failed') {
            applyTikTokResult(tiktokStatus, tiktokRegion)
            return
        }

        // Fallback: 主页面
        return fetchWithTimeout({
            url: 'https://www.tiktok.com/',
            opts: opts,
            timeout: TIMEOUT,
            headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
        }).then(resp => {
            const code = statusCode(resp)
            const body = resp.body || ''
            const parsed = parseTikTokResponse(code, body)

            if (tiktokStatus !== 'No') tiktokStatus = parsed.status
            if (!tiktokRegion) tiktokRegion = parsed.region

            applyTikTokResult(tiktokStatus, tiktokRegion)
        }).catch(() => {
            applyTikTokResult(tiktokStatus, tiktokRegion)
        })
    })
}

function parseTikTokResponse(code, body) {
    let status = 'Failed'
    let region = ''

    if (code === 403 || code === 451) {
        status = 'No'
    } else if (code >= 200 && code < 300) {
        const bodyLower = body.toLowerCase()
        if (bodyLower.indexOf('access denied') !== -1
            || bodyLower.indexOf('not available in your region') !== -1
            || bodyLower.indexOf('tiktok is not available') !== -1) {
            status = 'No'
        } else {
            status = 'Yes'
        }
    }

    const m = body.match(/"region"\s*:\s*"([a-zA-Z-]+)"/)
    if (m && m[1]) {
        region = m[1].split('-')[0].toUpperCase()
    }

    return { status, region }
}

function applyTikTokResult(status, region) {
    if (status === 'Yes') {
        result.TikTok = line('TikTok', '支持' + withRegion(region) + ' 🎉')
    } else if (status === 'No') {
        result.TikTok = line('TikTok', '未支持 🚫')
    } else {
        result.TikTok = line('TikTok', '检测失败 ❗️')
    }
}

// ═══════════════════════════════════════════════════
//  主入口 & HTML 输出
// ═══════════════════════════════════════════════════

; (async () => {
    try {
        // 初始化所有结果为默认值
        Object.keys(result).forEach(k => {
            if (!result[k]) result[k] = line(k, '检测失败 ❗️')
        })

        await Promise.all([
            testNetflix(),
            testYouTubePremium(),
            testSpotify(),
            testChatGPT(),
            testClaude(),
            testGemini(),
            testPrimeVideo(),
            testTikTok(),
        ].map(p => p.catch(e => console.log('Task error: ' + e))))

        const output = await getPolicyOutput()
        $done({ title: '    📺  流媒体 & AI 解锁检测', htmlMessage: buildHtml(output) })
    } catch (e) {
        console.log('Main error: ' + e)
        $done({
            title: '    📺  流媒体 & AI 解锁检测',
            htmlMessage: errorHtml(String(e || '检测异常')),
        })
    }
})()

function buildHtml(policyOutput) {
    const items = [
        result.Netflix,
        result.YouTube,
        result.Spotify,
        result.PrimeVideo,
        result.TikTok,
        result.ChatGPTiOS,
        result.ChatGPTWeb,
        result.Claude,
        result.Gemini,
    ]

    let html = '<div style="text-align: center; font-family: -apple-system; font-size: 15px; line-height: 1.6;">'
    html += '<hr style="margin: 8px 0; border: 0; border-top: 1px solid #ddd;"/>'
    html += items.join('<br/>')
    html += '<hr style="margin: 8px 0; border: 0; border-top: 1px solid #ddd;"/>'
    html += '<font color="#6959CD"><b>节点</b> ➟ ' + policyOutput + '</font>'
    html += '</div>'
    return html
}

function errorHtml(msg) {
    return '<p style="text-align: center; font-family: -apple-system; font-size: large; font-weight: bold;">🚥 ' + msg + '</p>'
}

function getPolicyOutput() {
    return new Promise(resolve => {
        const message = { action: 'get_policy_state', content: $environment.params }
        $configuration.sendMessage(message).then(response => {
            if (response && response.error) {
                resolve($environment.params)
                return
            }
            if (response && response.ret && response.ret[message.content]) {
                const output = JSON.stringify(response.ret[message.content])
                    .replace(/\\"|[\[\]]/g, '')
                    .replace(/,/g, ' ➟ ')
                resolve(output || $environment.params)
                return
            }
            resolve($environment.params)
        }, () => resolve($environment.params))
    })
}