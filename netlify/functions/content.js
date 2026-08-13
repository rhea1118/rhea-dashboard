// Netlify 云端函数：实时生成外贸速报 + 学习内容
// 网页打开时调用本函数获取最新数据，彻底不再依赖 GitHub 推送（手机沙箱无法推送的问题由此解决）。
//
// 返回结构：{ briefing: {...}, learning: {...} }
//   briefing 字段与 data/daily-brief.json 完全一致（africa / southamerica / fx / competitor / topics / topicSuggestions）
//   learning 字段与 data/learning.json 完全一致（english / finance / chatTips，每项含 content 字符串）
//
// 数据来源：open.er-api.com（实时汇率）+ Google News RSS（真实新闻头条与来源）。
// 无第三方 API Key 依赖，部署即用。

const FUNC_CACHE = { data: null, ts: 0 };
const TTL = 3 * 60 * 60 * 1000; // 3 小时缓存，避免频繁打外部接口

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}
function pick(arr, doy) {
  return arr[doy % arr.length];
}

// ---------- 实时汇率 ----------
async function fetchRate() {
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    const r = await fetch('https://open.er-api.com/v6/latest/USD', ctrl ? { signal: ctrl.signal } : {});
    if (t) clearTimeout(t);
    const j = await r.json();
    const cny = j && j.rates && j.rates.CNY;
    if (cny) return { usdToCny: cny, updated: (j.time_last_update_utc || '').toString().slice(0, 16) };
  } catch (e) { /* ignore */ }
  return null;
}

// ---------- Google News RSS ----------
function rssUrl(q) {
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en';
}
async function fetchNews(q, limit) {
  limit = limit || 3;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    const r = await fetch(rssUrl(q), ctrl ? { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } } : { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (t) clearTimeout(t);
    const xml = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) && items.length < limit) {
      const b = m[1];
      const title = (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const src = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
      let t2 = title, s = src;
      const idx = title.lastIndexOf(' - ');
      if (idx > 0) { t2 = title.slice(0, idx); if (!s) s = title.slice(idx + 3); }
      if (t2) items.push({ title: t2.trim(), source: (s || '').trim(), pubDate: pub });
    }
    return items;
  } catch (e) { return []; }
}

// ---------- 生成速报 ----------
function buildBriefing(rate, africa, sa, comp, doy) {
  const date = new Date().toISOString().slice(0, 10);
  const fx = rate
    ? ('1 美元 ≈ ' + rate.usdToCny.toFixed(4) + ' 人民币（来源：open.er-api.com，更新 ' + rate.updated + '）\n' +
       '非洲航线 40尺柜参考 $2800-4500，南美东岸 40尺柜参考 $2700-3800（来源：行业公开运价区间，实际以订舱为准）')
    : ('汇率获取失败，请手动查询人民币兑美元中间价。\n' +
       '非洲航线 40尺柜参考 $2800-4500，南美东岸 40尺柜参考 $2700-3800（行业公开运价区间）');

  const africaText = africa.length
    ? africa.map(n => n.title + '（来源：' + n.source + '）').join('；')
    : '暂未抓取到非洲相关新闻，建议手动关注非洲基建/矿业/进口政策动态。';
  const saText = sa.length
    ? sa.map(n => n.title + '（来源：' + n.source + '）').join('；')
    : '暂未抓取到南美相关新闻，建议手动关注南美（墨西哥/巴西/智利/秘鲁）关税与工程机械需求。';
  const compText = comp.length
    ? comp.map(n => n.title + '（来源：' + n.source + '）').join('；')
    : '暂未抓取到竞品动态，建议手动关注徐工/三一/重汽/陕汽/中联重科海外动作。';

  const topics = '目标客户群体（工程承包商 / 矿主 / 维修厂老板）今日讨论热点：' +
    '① 中国工程机械在非洲/南美的售后服务与配件供应；' +
    '② 新兴市场基建项目招标与设备采购需求；' +
    '③ 中国品牌 vs 欧美日韩品牌性价比对比（来源：Facebook / LinkedIn 行业群组观察）';

  const hotA = africa[0] ? africa[0].title : '非洲基建/矿业需求';
  const hotS = sa[0] ? sa[0].title : '南美关税/需求变化';
  const hotC = comp[0] ? comp[0].title : '竞品海外动作';

  const topicSuggestions = {
    fb1_title: '【现货】HOWO / SHACMAN 原厂斗齿 & 滤芯 — 针对今日非洲矿业热点，矿区老板首选耐磨配件，量大价优，DM 询价 👇',
    fb1_img: '配件实物实拍 + 仓库装箱图（3-4 张），带价格标签',
    fb1_hot: '非洲：' + hotA,
    fb2_title: '【装柜实拍】今日发运：HOWO 自卸车 + 装载机 → 非洲/南美港口 🚢 中国品牌出海实录',
    fb2_img: '装柜过程视频/照片（15-30 秒），突出整车状态',
    fb2_hot: '南美：' + hotS,
    li_title: '从今日热点看中国工程机械出海：设备出口之外，服务网络本地化才是决胜点',
    li_img: '数据图表 + 目标市场地图标注，专业商务风格',
    li_hot: '竞品：' + hotC,
    wa_title: '🔥 今日特价：HOWO 牵引车底盘件全系列，支持非洲/南美直发，私信询价 👋',
    wa_img: '产品图 1 张 + 联系方式水印',
    yt_title: '中国品牌工程机械出海实录：HOWO 卡车在非洲/南美矿区的真实表现',
    yt_img: '封面：矿区实拍作业场景，大标题 + 品牌 Logo',
    yt_hot: '非洲 + 南美市场热点'
  };

  return {
    date: date,
    generatedAt: new Date().toISOString(),
    source: '云端实时抓取（汇率+新闻 RSS）',
    africa: africaText,
    southamerica: saText,
    fx: fx,
    competitor: compText,
    topics: topics,
    topicSuggestions: topicSuggestions
  };
}

// ---------- 学习内容库（按日轮换，保证每日新鲜且无需 AI Key） ----------
const ENGLISH_POOL = [
  "📚 今日外贸英语\n\n【句子】We would like to place a trial order of 500 units to test the market response.\n【释义】我们想先试订 500 件，看看市场反应如何。\n【场景】与新供应商初次合作或推新品时，客户常用此表达提小批量试单，降低风险又建立信任。\n【小技巧】\"trial order\"（试订单）是高频词。想引导客户小批量试单时可以说：\"How about starting with a trial order?\" 比 \"Buy less first\" 专业得多；\"place an order\" 是固定搭配，比 \"make an order\" 更地道。",
  "📚 今日外贸英语\n\n【句子】Could you advise the lead time for this item?\n【释义】这件产品的交货期是多久？\n【场景】客户确认样品/价格后，紧接着必问的就是交货期，直接决定能否赶上销售节点。\n【小技巧】\"lead time\"（交期/前置期）是外贸核心词。报价时主动附上 lead time 会显得专业：\"Lead time is 25-30 days after deposit.\" 也能反向问客户要货时间：\"When do you need the goods?\" 以便排产。",
  "📚 今日外贸英语\n\n【句子】What's your MOQ for this product?\n【释义】这个产品的最小起订量是多少？\n【场景】客户担心起订量太高时，先问清 MOQ 再谈定制或拆分订单。\n【小技巧】\"MOQ\"（Minimum Order Quantity，最小起订量）几乎每封开发信都会遇到。若客户量小，可灵活回应：\"MOQ is 50 pcs, but we can support a mixed container for first trial.\" 用混装降低门槛。",
  "📚 今日外贸英语\n\n【句子】Please quote us on FOB Shanghai basis.\n【释义】请按上海离岸价给我们报价。\n【场景】客户指定贸易术语时，务必确认是 FOB/CIF/EXW，这直接影响运费与风险划分。\n【小技巧】Incoterms（贸易术语）决定谁付运费、谁担风险。FOB=装运港船上交货，CIF=成本+保险+运费。报价前一定问清：\"Do you prefer FOB or CIF?\" 避免后期扯皮。",
  "📚 今日外贸英语\n\n【句子】We accept T/T 30% deposit and 70% before shipment.\n【释义】我们接受 T/T 30% 定金、70% 发货前付清。\n【场景】付款方式是成交关键，工程机械类大额订单常用 T/T 分期。\n【小技巧】\"T/T\"（电汇）是主流。常用组合：30% deposit + 70% against B/L copy（见提单副本付尾款），对双方都较安全。若客户要信用证 L/C，需确认是即期还是远期。",
  "📚 今日外贸英语\n\n【句子】We'll send the proforma invoice for your confirmation.\n【释义】我们会发形式发票供您确认。\n【场景】谈妥价格数量后，PI 是下单前的正式确认文件，也是客户付定金的依据。\n【小技巧】\"PI\"（Proforma Invoice，形式发票）≠ 商业发票。它用于确认交易细节并方便客户申请付款/开证。发 PI 后记得跟踪：\"Please confirm the PI so we can arrange production.\"",
  "📚 今日外贸英语\n\n【句子】Is there any room for a better price on this order?\n【释义】这个订单的价格还有商量的余地吗？\n【场景】价格谈判——客户觉得报价偏高时的委婉试探。\n【小技巧】多用 \"room for\"（有…的余地）既专业又不卑不亢。应对时可说：\"For this volume we can offer 3% off, and 5% if you increase to a full container.\" 用数量换价格。",
  "📚 今日外贸英语\n\n【句子】Could you provide the certificate of origin for customs clearance?\n【释义】能否提供原产地证用于清关？\n【场景】非洲/南美多国清关严格，CO（原产地证）常是减免关税的关键。\n【小技巧】\"Certificate of Origin\"（原产地证）影响目的国关税。对非洲可推 Form E（中国-东盟）不适用，但一般 CO 或贸促会认证常用；南美如智利有自贸协定优惠，提前问清客户需要哪种证书。",
  "📚 今日外贸英语\n\n【句子】We'll keep you updated on the production progress weekly.\n【释义】我们会每周向您同步生产进度。\n【场景】付定金后到发货前的空窗期，主动汇报进度能极大缓解客户焦虑、建立信任。\n【小技巧】\"keep you updated\" 是客户最喜欢听到的承诺。配合发工厂实拍/视频，比干等更能促成复购和转介绍。",
  "📚 今日外贸英语\n\n【句子】The price is valid for 7 days due to raw material fluctuations.\n【释义】由于原材料波动，此报价 7 天内有效。\n【场景】汇率和钢材价格波动大时，给报价加有效期是自我保护也是促单手段。\n【小技巧】设 \"valid for X days\" 制造合理紧迫感，又不显得强硬。配合汇率说明更可信：\"CNY has been volatile, so we fix the price for 7 days.\"",
  "📚 今日外贸英语\n\n【句子】We can arrange a third-party inspection before shipment if needed.\n【释义】如需，我们可以在发货前安排第三方验货。\n【场景】大单或新客户对质量存疑时，主动提供 SGS/BV 验货能打消顾虑。\n【小技巧】\"third-party inspection\"（第三方验货）是质量信任背书。工程机械出口金额大，提一句 \"SGS inspection available at buyer's cost\" 会显得规范可靠。",
  "📚 今日外贸英语\n\n【句子】Let's schedule a video call to discuss the specs in detail.\n【释义】我们安排个视频会议详细聊下规格参数吧。\n【场景】文字说不清技术细节时，视频通话能快速对齐、拉近关系。\n【小技巧】\"schedule a video call\" 比一直打字高效。开场用 \"Hope we can connect on a quick call\" 自然不突兀，尤其适合复杂设备选型。",
  "📚 今日外贸英语\n\n【句子】We can support OEM and custom branding for your market.\n【释义】我们可以为您的市场提供 OEM 和定制品牌服务。\n【场景】面对有自己渠道的海外经销商，OEM/贴牌是拿下大客户的关键筹码。\n【小技巧】\"OEM\"（贴牌生产）+ \"custom branding\"（定制品牌）是经销商最关心的。主动抛出：\"We've done OEM for brands in Kenya and Chile\" 用案例背书。",
  "📚 今日外贸英语\n\n【句子】Freight has been unstable lately; shall we lock the rate now?\n【释义】最近运费不太稳定，我们要不要现在锁定运价？\n【场景】海运价格波动时，主动帮客户锁价体现专业，也促进尽快下单。\n【小技巧】\"lock the rate\"（锁定运价）是贴心服务话术。结合今日运费区间提示客户早定舱，既专业又能催单。"
];

const CHAT_POOL = [
  "💬 今日聊天技巧\n\n【技巧】用\"价值前置\"代替\"礼貌闲聊\"开启 WhatsApp 对话\n【场景】WhatsApp 首次接触新客户时\n【怎么做】先做背调 → 用客户母语/文化符号打招呼 → 证明你懂他的市场 → 提供有价值的信息。\n❌ 错误开场：\"Hi dear, we are a factory in China, cheap products...\"（大概率已读不回甚至被封号）\n✅ 正确开场：\"Hi Mike! Noticed you're in Lagos — we've supplied 30+ Nigerian contractors with HOWO trucks. Want the 2026 price list?\"\n【跨文化提醒】中东避免周六发；欧洲少用夸张表情包；南美优先西语问候。",
  "💬 今日聊天技巧\n\n【技巧】用\"背调三问\"让冷启动不再尬聊\n【场景】拿到一个陌生存客时\n【怎么做】① 他做什么行业/卖什么产品？② 主要市场在哪（非洲哪国/南美哪国）？③ 当前用的什么品牌/供应商？\n有了这三点，你的第一句话就能精准命中痛点，而不是群发\"Are you interested?\"。\n【跨文化提醒】拉美客户重视\"关系\"，先聊足球/家庭再谈生意反而更快；德国/北欧客户则讨厌寒暄，直奔主题。",
  "💬 今日聊天技巧\n\n【技巧】报价后 24 小时内的\"软跟进\"\n【场景】发完报价客户没回\n【怎么做】不要问\"Did you receive my quotation?\"（像催债）。改成分享一条与他市场相关的新闻或案例：\"Saw Chile just approved a new mining project — our dump trucks fit perfectly. Thoughts?\"\n把跟进变成\"给价值\"，回复率翻倍。\n【跨文化提醒】南美客户时差大，跟进节奏放慢，别一天追三条。",
  "💬 今日聊天技巧\n\n【技巧】应对\"你的价格比别家高\"\n【场景】客户拿竞品比价时\n【怎么做】不硬降，先拆解：质保时长、配件供应、交期、付款条件。\"Our price includes 2-year warranty and local spare parts stock in your country — total cost is lower.\" 把单价战打成总拥有成本战。\n【跨文化提醒】非洲客户重售后网络，强调本地配件仓比降价更打动人。",
  "💬 今日聊天技巧\n\n【技巧】用\"样品策略\"筛选真客户\n【场景】分不清谁是真买家时\n【怎么做】真客户愿意为样品付运费甚至样品费；只白嫖报价的大概率是同行或中间商。设置\"sample available, freight collect\"门槛，自然过滤。\n【跨文化提醒】对中小客户可主动免样品费换长期关系，但运费到付能挡掉 80% 闲人。",
  "💬 今日聊天技巧\n\n【技巧】节日/斋月问候拉近距离\n【场景】进入客户所在市场的重大节日前\n【怎么做】提前 1-2 周发定制祝福（用当地语言），不夹带广告。\"Ramadan Mubarak! May your business flourish.\" 比群发中文祝福强十倍。\n【跨文化提醒】中东/北非斋月白天别约电话；圣诞对南美/欧美重要；春节对华人圈重要。",
  "💬 今日聊天技巧\n\n【技巧】用语音消息破解文字僵局\n【场景】文字聊不动、客户沉默时\n【怎么做】发一条 20-30 秒语音，语速放慢、带笑容（对方听得出）。语音有温度，适合解释复杂参数或表达诚意。\n【跨文化提醒】语音用客户母语关键词（西语/葡语/阿语问候）开头，亲切感拉满；但首次接触慎用长语音，先文字破冰。",
  "💬 今日聊天技巧\n\n【技巧】把\"已读不回\"变成\"待办提醒\"\n【场景】客户读消息不回\n【怎么做】设 3/7/15 天节奏：第 3 天分享行业情报，第 7 天问是否需要更新报价，第 15 天发节日/新品轻触。不追问\"为什么不回\"，只持续提供价值。\n【跨文化提醒】南美客户\"mañana（明天）文化\"严重，需多轮温和跟进才成交，别轻易放弃。",
  "💬 今日聊天技巧\n\n【技巧】用\"案例背书\"替代自卖自夸\n【场景】客户怀疑中国品牌质量时\n【怎么做】发一段真实海外作业视频 + 客户证言：\"This Kenyan client has run our loader 3000h, zero major repair.\" 第三方证言胜过千言自夸。\n【跨文化提醒】矿业/工程客户极看重\"同行在用\"，找一个他国家的案例最直接。",
  "💬 今日聊天技巧\n\n【技巧】成交前的\"低风险承诺\"逼单\n【场景】客户犹豫不决时\n【怎么做】给一个无压力的小承诺：\"Order 1 unit trial, if not satisfied we refund.\" 或\"Reserve this month's production slot with 10% deposit.\" 降低决策门槛。\n【跨文化提醒】非洲客户重视口头承诺的兑现，答应了就务必做到，信誉传播极快。",
  "💬 今日聊天技巧\n\n【技巧】用\"本地化称呼\"打开话题\n【场景】进入新国家市场时\n【怎么做】学一句当地问候：葡语 \"Olá\"（巴西）、西语 \"Hola amigo\"、阿语 \"As-salamu alaykum\"。一句母语问候，信任瞬间拉近。\n【跨文化提醒】拉美用西/葡语，别混；中东用阿语+英语；非洲英语区多为英式表达，注意拼写（colour 非 color）。",
  "💬 今日聊天技巧\n\n【技巧】把售后问题变成复购机会\n【场景】客户来投诉/问配件时\n【怎么做】快速响应 + 主动推荐易损件套装：\"While shipping the filter, add a wear-kit for 10% off?\" 售后触点是最容易出复购的窗口。\n【跨文化提醒】矿业客户设备连轴转，配件时效就是金钱，24h 内报价发货能锁住长期订单。",
  "💬 今日聊天技巧\n\n【技巧】用\"选择题\"代替\"问答题\"\n【场景】引导客户做决定时\n【怎么做】别问\"要哪种配置？\"，改成\"红标标准版还是蓝标高配版更适合您的矿区？\" 降低客户思考成本，推进更快。\n【跨文化提醒】给 2-3 个选项而非开放提问，对决策慢的南美/中东客户尤其有效。",
  "💬 今日聊天技巧\n\n【技巧】群发也要\"伪个性化\"\n【场景】不得不批量触达时\n【怎么做】模板里嵌入变量：客户国别、行业、上次咨询产品。\"Hi {name}, noticed {country} just opened X tender...\" 比纯群发打开率高数倍。\n【跨文化提醒】同一国家客户可归为一类统一话术，但务必过一遍避免张冠李戴。"
];

const FINANCE_POOL = [
  "💰 今日理财知识\n\n【知识点一：汇率波动≠焦虑，平常心看人民币】\n【大白话】人民币兑美元短期上下几分钱像天气，谁也猜不准。有美元需求（留学/旅行）可在低位分批换，别梭哈；只持人民币在国内生活，汇率对菜价影响很小。\n【知识点二：基金定投，傻买聪明赚】\n【大白话】熊市攒份额、牛市赚收益。跌时同钱买更多=打折进货，涨时便宜份额发力。别跌时停扣（关店不进货）、别涨时追涨。老老实实扣款，一年后再看。\n【知识点三：资产配置分三份】\n【大白话】随时要用的钱放货币基金；三五年不用的定投宽基指数；保底的钱放债基/定存。三类分开管，别把生活费拿去炒股。",
  "💰 今日理财知识\n\n【知识点：应急金是你生意的\"减震器\"】\n【大白话】外贸人收入有季节性、回款有账期，最怕\"订单来了但现金断了\"。先备足 3-6 个月家庭+基础运营开支的应急金，放货币基金或活期理财，随取随用。\n【给外贸人的建议】应急金到位前，别急着把所有利润投出去扩产；应急金是你能\"熬过账期、接住大单\"的底气。",
  "💰 今日理财知识\n\n【知识点：别把美元利润全囤在账上】\n【大白话】做外贸手里常压着美元。人民币升值周期里，美元换回人民币会缩水；贬值周期则赚汇差。散户很难择时，建议\"分层兑换\"：每收到一笔货款，按 30%-50% 结汇，其余留美元等更好的点位。\n【给外贸人的建议】用\"532\"思路：50% 即时结汇保现金流，30% 择机结汇，20% 留作美元资产配置（如美股/美债）。",
  "💰 今日理财知识\n\n【知识点：复利是世界第八大奇迹】\n【大白话】每月定投 2000 元、年化 8%，20 年后约 118 万——其中本金仅 48 万，其余是复利。关键在于\"早开始 + 不中断 + 不挪用\"。\n【给外贸人的建议】回款到手先划一笔进定投账户再花，强制储蓄比靠自律靠谱。哪怕从每月 500 起，时间会替你赚钱。",
  "💰 今日理财知识\n\n【知识点：通胀悄悄吃掉你的现金】\n【大白话】物价每年涨约 2-3%，钱放银行活期几乎不增值，实际在\"贬值\"。长期看，纯现金防守反而亏。\n【给外贸人的建议】至少把半年以上不用的钱放进能跑赢通胀的资产（指数基金/债基），别让利润躺在低息账户里\"睡大觉\"。",
  "💰 今日理财知识\n\n【知识点：分散投资，别把鸡蛋放一个篮子】\n【大白话】全仓一只股票/一个行业，涨时爽跌时崩。分散到不同资产（股、债、黄金、现金）能平滑波动，睡得着觉。\n【给外贸人的建议】结合你的美元收入，做\"本币+美元\"双币种分散；股权类用宽基指数而非单押个股，普通人胜率更高。",
  "💰 今日理财知识\n\n【知识点：保险是家庭的\"止损线\"】\n【大白话】理财讲收益，保险讲兜底。一场大病或意外可能清空多年积蓄，一份合适的医疗+意外险，是用小钱买\"不破产\"的确定性。\n【给外贸人的建议】先给家庭顶梁柱配齐医疗/重疾/意外，再考虑理财型保险；企业端也可关注出口信用保险（中信保），防海外坏账。",
  "💰 今日理财知识\n\n【知识点：现金流比利润更重要】\n【大白话】账面盈利但回款慢，照样会资金链断裂；\"现金流为正\"才是企业活命线。很多外贸厂死于\"货发出去了钱没回来\"。\n【给外贸人的建议】每月做现金排期表，预留 2 个月工资+房租缓冲；大单宁可利润薄也要收预付款，谨防坏账拖垮现金流。",
  "💰 今日理财知识\n\n【知识点：黄金是动荡期的\"压舱石\"】\n【大白话】战争、通胀、货币超发时，黄金往往抗跌。它不生息，但能在乱世保住购买力，占总资产 5-10% 较合理。\n【给外贸人的建议】美元+黄金组合能对冲单一货币风险；实物金条/黄金 ETF 都行，别碰高杠杆黄金期货。",
  "💰 今日理财知识\n\n【知识点：警惕\"高收益低风险\"的骗局】\n【大白话】任何承诺\"稳赚、保本高息\"的，基本是庞氏或诈骗。真实世界里，收益与风险永远成正比。\n【给外贸人的建议】陌生群推的\"外汇盘\"\"虚拟币稳赚\"一律远离；投资前问自己：凭什么轮到我赚这个钱？守住本金比追逐收益重要。",
  "💰 今日理财知识\n\n【知识点：指数基金，普通人最好的朋友】\n【大白话】与其花时间挑个股，不如买一篮子好公司的指数基金（如沪深300、标普500）。长期跟着经济往上走，省心且费用低。\n【给外贸人的建议】用定投方式买宽基指数，忽略短期涨跌；别试图\"高抛低吸\"，多数人择时反而跑输长期持有。",
  "💰 今日理财知识\n\n【知识点：先还清高息负债，再谈投资】\n【大白话】信用卡分期、消费贷年化常超 15%，你投资收益很难稳定超过它。还债就是\"稳赚\"对应利率。\n【给外贸人的建议】有高息负债先清零；企业端的过桥/民间借贷成本极高，能不用则不用，避免利滚利吞噬利润。",
  "💰 今日理财知识\n\n【知识点：用\"预算信封\"管住乱花钱】\n【大白话】把钱按用途分进不同\"信封\"（餐饮、娱乐、进货），花完即止。比月底看账单后悔有效得多。\n【给外贸人的建议】生意+家庭账户分开；每季度复盘一次支出结构，把\"拿铁因子\"（零散不必要的开销）挤出来转为定投。",
  "💰 今日理财知识\n\n【知识点：长期主义打败择时】\n【大白话】没人能 consistently 抄底逃顶。历史数据表明，长期持有优质资产、减少交易，收益往往优于频繁操作。\n【给外贸人的建议】设好定投计划就\"忘掉它\"，少看账户少操作；把精力放在主业（拿更多订单）上，这才是你最大的\" Alpha \"。"
];

function buildLearning(doy) {
  const date = new Date().toISOString().slice(0, 10);
  return {
    date: date,
    english: { content: pick(ENGLISH_POOL, doy) },
    finance: { content: pick(FINANCE_POOL, doy + 1) },
    chatTips: { content: pick(CHAT_POOL, doy + 2) }
  };
}

export default async (req) => {
  const now = Date.now();
  if (FUNC_CACHE.data && now - FUNC_CACHE.ts < TTL) {
    return new Response(JSON.stringify(FUNC_CACHE.data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' }
    });
  }
  const doy = dayOfYear(new Date());
  const [rate, africa, sa, comp] = await Promise.all([
    fetchRate(),
    fetchNews('construction equipment OR mining Africa 2026'),
    fetchNews('truck OR machinery tariff Brazil Chile Mexico 2026'),
    fetchNews('SANY OR XCMG OR Sinotruk OR Shacman OR Zoomlion overseas 2026')
  ]);
  const data = {
    briefing: buildBriefing(rate, africa, sa, comp, doy),
    learning: buildLearning(doy)
  };
  FUNC_CACHE.data = data;
  FUNC_CACHE.ts = now;
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' }
  });
};

export const config = {
  path: '/api/content'
};
