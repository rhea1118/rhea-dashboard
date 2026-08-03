const fs = require('fs');
const https = require('https');

const configPath = 'F:/workbuddy data/2026-07-27-16-14-23/rhea-dashboard/deploy-config.json';
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const token = cfg.github.token;

if (!token || token.includes('REPLACE')) {
    console.log('[SKIP] token 未配置，跳过 GitHub 触发');
    process.exit(0);
}

const clientPayload = {
    africa: '非洲基建矿业需求持续升温。山东临工首批超大型挖掘机正式进驻南非大型金属矿，实现超大挖在当地的首次交付；山推连续第六年亮相肯尼亚BUILDEXPO，累计接待超200位精准意向客户；柳工电动装载机856HE/870HE批量交付南非金矿及水泥厂客户。来源：工程机械商贸网、临工集团、柳工国际。',
    southamerica: '巴西大幅削减628种机械进口关税至零关税（5月15日生效至2027年12月），覆盖挖掘机、装载机等核心品类，2026年工程机械市场预计达27.7亿美元；但巴西同时上调1252种商品关税（部分针对亚洲），墨西哥工程机械进口需NOM认证（HS 8429.51.01税率7.5%）。来源：sdsgmachinery、中国贸促会、sinotruckexp。',
    fx: '7月30日人民币兑美元中间价报6.7899，在岸收盘6.7655，离岸6.7608，人民币延续偏强。非洲40尺HQ参考运费2500-5000美元；南美东（桑托斯）40HQ基本运费约5100-5380美元；达飞7月15日起大幅上调亚欧/北非FAK运价，北欧40HQ达7000美元。来源：腾讯新闻、德鲁里、博丰物流。',
    competitor: '三一电动重卡6月800余台发往海外，刷新中国新能源牵引车单次出口规模纪录；中联重科海外收入占比逼近60%，1-4月国际订单增长超80%；2026年1-5月中国工程机械出口总额279.02亿美元，同比增长20.8%。来源：每日经济新闻、长沙晚报。',
    topics: 'LinkedIn热议：埃塞俄比亚KEFI金矿项目（Tulu Kapi）破土动工，总投资3.4亿美元，预计2027年年产14万盎司黄金；阿根廷Vicuña铜矿项目BHP与Lundin今年投资7.9亿美元，总投资或达200亿美元，属全球前10铜矿项目；阿根廷矿业预计到2032年创造25万就业。来源：LinkedIn、Bloomberg。',
    topicSuggestions: {
        fb1_title: '南非矿山首迎超大挖！临工首批超大型挖掘机进驻金属矿现场，客户好评不断。',
        fb1_img: '产品实拍：临工超大挖在南非矿山作业现场，配非洲地貌背景',
        fb1_hot: '非洲矿山设备升级热潮、南非矿业投资',
        fb2_title: '从肯尼亚到南非，中国工程机械非洲版图再扩张！山推六度参展BUILDEXPO，柳工电动设备批量交付多国。',
        fb2_img: '展会现场/批量交付仪式，含非洲客户合影与设备阵列',
        fb2_hot: '非洲基建、绿色电动化、中国智造出海',
        li_title: '巴西628种机械零关税窗口期：中国工程机械进入南美最大市场的关键12个月',
        li_img: '信息图：巴西关税对比表（旧税率 vs 零关税）+ 市场预测数据',
        li_hot: '巴西关税政策、工程机械出海、南美市场机遇',
        wa_title: '今日汇率：人民币中间价6.7899偏强｜非洲40HQ运费2500-5000美元｜南美东5100-5380美元。运费旺季附加费已启动，提前订舱锁定成本！',
        wa_img: '简洁汇率+运费数据卡片，适合手机竖屏',
        yt_title: '实拍：7台徐工XE3000矿挖非洲露天矿10个月单机5000小时实战纪录',
        yt_img: '矿山作业航拍+设备数据叠加（5000小时、95%可动率）'
    }
};

const body = JSON.stringify({
    event_type: 'generate-trade-brief',
    client_payload: clientPayload
});

const options = {
    hostname: 'api.github.com',
    path: '/repos/rhea1118/rhea-dashboard/dispatches',
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'WorkBuddy-Auto',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        if (res.statusCode === 204 || res.statusCode === 200) {
            console.log('[GITHUB] ✅ 已触发 generate-trade-brief，Actions 将在 1-2 分钟内处理');
        } else {
            console.log(`[GITHUB] ❌ 触发失败: HTTP ${res.statusCode}`);
            console.log(`[GITHUB] 错误详情: ${data}`);
        }
    });
});

req.on('error', (e) => {
    console.log(`[GITHUB] ❌ 请求失败: ${e.message}`);
});

req.write(body);
req.end();
