'use strict';
// 测试语料
// - 代码：OpenAI HumanEval (164 题, MIT) + Google MBPP (974 题, CC-BY-4.0)
// - 其余领域（订单、新闻、数学、客服对话）由下面的模板按种子生成，可复现、无版权问题
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function norm(s) {
  return String(s || '').replace(/\r\n/g, '\n').replace(/\t/g, '    ').replace(/[ ]+\n/g, '\n');
}

const readJsonl = (f) =>
  fs
    .readFileSync(path.join(DATA_DIR, f), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
const HE = readJsonl('HumanEval.jsonl');
const MB = readJsonl('mbpp.jsonl');

const ITEMS = [
  ...HE.map(
    (o) => `### ${o.task_id} · ${o.entry_point}\n\`\`\`python\n${norm(o.prompt)}${norm(o.canonical_solution)}\n# ---- tests ----${norm(o.test)}\`\`\`\n`
  ),
  ...MB.map(
    (o) =>
      `### MBPP/${o.task_id}\n# Task: ${norm(o.text).trim()}\n\`\`\`python\n${norm(o.code).trim()}\n# ---- tests ----\n${o.test_list.map(norm).join('\n')}\n\`\`\`\n`
  ),
];
const TOTAL_CHARS = ITEMS.reduce((a, s) => a + s.length, 0);

// 英文需求条目：MBPP 题目描述 + HumanEval 的 docstring（去掉 >>> 示例）
const EN_ITEMS = [
  ...MB.map((o) => `- [MBPP-${o.task_id}] ${norm(o.text).trim()} Acceptance check: ${norm(o.test_list[0]).trim()}`),
  ...HE.map((o) => {
    const m = /("""|''')([\s\S]*?)\1/.exec(o.prompt);
    const doc = (m ? m[2] : '')
      .split('\n')
      .filter((l) => !/^\s*(>>>|\.\.\.)/.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `- [${o.task_id}] Implement \`${o.entry_point}\`. ${doc}`;
  }),
];

// ---------------- 可复现的伪随机
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const rng = (seedStr) => mulberry32(hashSeed(String(seedStr)));
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const rint = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : `{${k}}`));

function shuffled(arr, seedStr) {
  const rnd = rng(seedStr);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 把 items 按种子打乱后拼到约 targetChars 字符（不足时换种子再来一轮） */
function fromItems(items, targetChars, seedStr) {
  const parts = [];
  let len = 0;
  for (let round = 0; len < targetChars; round++) {
    for (const it of shuffled(items, `${seedStr}#${round}`)) {
      if (len >= targetChars) break;
      if (len + it.length > targetChars && len > 0) {
        const rest = targetChars - len;
        if (rest > 200) parts.push(it.slice(0, rest));
        len = targetChars;
        break;
      }
      parts.push(it);
      len += it.length;
    }
  }
  return parts.join('\n');
}

/** 反复调用 gen(rnd, k) 生成条目，拼到约 targetChars 字符 */
function fromGen(gen, targetChars, seedStr) {
  const rnd = rng(seedStr);
  const parts = [];
  let len = 0;
  for (let k = 1; len < targetChars; k++) {
    let it = gen(rnd, k);
    if (len + it.length > targetChars && len > 0) it = it.slice(0, Math.max(0, targetChars - len));
    parts.push(it);
    len += it.length + 1;
  }
  return parts.join('\n');
}

/** 按种子打乱代码题顺序，拼出约 targetChars 字符的语料 */
const buildCorpus = (targetChars, seedStr) => fromItems(ITEMS, targetChars, seedStr);

// ---------------- 生成器用到的词表
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高梁宋郑谢韩唐冯'.split('');
const GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '洋', '艳', '勇', '军', '杰', '娟', '涛', '明', '超', '秀英', '晨', '欣怡', '子轩', '浩然', '雨桐', '梓涵', '宇航', '诗琪', '俊杰', '嘉怡', '一诺', '思远'];
const CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '武汉', '西安', '南京', '苏州', '天津', '长沙', '郑州', '青岛', '厦门', '合肥', '昆明', '沈阳', '大连', '宁波', '福州', '济南', '哈尔滨'];
const PRODUCTS = [
  ['KB-87', '机械键盘', 399], ['MS-PRO', '无线鼠标', 159], ['HD-ANC', '降噪耳机', 899], ['PB-20K', '充电宝', 129],
  ['AF-55', '空气炸锅', 329], ['RB-X3', '扫地机器人', 1999], ['TB-S2', '电动牙刷', 269], ['WM-90', '智能手表', 1299],
  ['LM-LED', '护眼台灯', 219], ['SP-MINI', '蓝牙音箱', 199], ['CF-01', '胶囊咖啡机', 899], ['HY-4L', '加湿器', 189],
  ['CB-65', '65W 充电器', 149], ['MON-27', '27 寸显示器', 1499], ['BAG-15', '双肩电脑包', 259], ['TH-500', '保温杯', 89],
];
const name = (rnd) => pick(rnd, SURNAMES) + pick(rnd, GIVEN);
const pad = (n, w = 2) => String(n).padStart(w, '0');

// 电商订单（JSON Lines）
function genOrder(rnd, k) {
  const items = [];
  for (let i = rint(rnd, 1, 3); i > 0; i--) {
    const [sku, title, price] = pick(rnd, PRODUCTS);
    items.push({ sku, title, qty: rint(rnd, 1, 3), price });
  }
  const sum = items.reduce((a, x) => a + x.qty * x.price, 0);
  const coupon = sum > 500 ? pick(rnd, [0, 20, 50, 100]) : pick(rnd, [0, 0, 10]);
  const m = rint(rnd, 1, 11);
  return JSON.stringify({
    order_id: `SO-2026${pad(m)}${pad(rint(rnd, 1, 28))}-${pad(k, 5)}`,
    customer: { name: name(rnd), city: pick(rnd, CITIES), level: pick(rnd, ['普通', '银卡', '金卡', '黑卡']) },
    items,
    coupon,
    total: sum - coupon,
    pay: pick(rnd, ['微信支付', '支付宝', '银行卡', '花呗分期']),
    paid_at: `2026-${pad(m)}-${pad(rint(rnd, 1, 28))} ${pad(rint(rnd, 7, 23))}:${pad(rint(rnd, 0, 59))}`,
    status: pick(rnd, ['待付款', '已付款', '已发货', '已签收', '退款中', '已关闭']),
    remark: pick(rnd, ['尽快发货', '周末送达', '不要放快递柜', '开发票，抬头为公司', '送礼用，请去掉价格标签', '', '']),
  });
}

// 中文新闻稿：8 个主题，每篇随机抽 4~5 句并填入数字
const NEWS = [
  ['{city}地铁{n1}号线{dir}开通试运营', [
    '{city}地铁{n1}号线{dir}于{m}月{d}日开通试运营，线路全长约{k}公里，共设车站{n2}座。',
    '据{city}市交通运输局介绍，新线开通后，沿线居民的平均通勤时间缩短了约{p}%。',
    '试运营首日客流超过{w}万人次，早高峰期间各站秩序井然，未出现明显拥堵。',
    '下一步，{city}还将加快推进{n3}条在建线路的施工，力争{y}年底前实现主城区轨道交通全覆盖。',
    '家住沿线的市民{person}说，以前上班要倒两趟公交，现在坐地铁{n4}分钟就能到公司。',
  ]],
  ['{city}新增{n2}所公办学校 新学期增加学位{w}00个', [
    '{city}市教育局{m}月{d}日发布消息，今年秋季学期全市新增公办中小学{n2}所，新增学位约{w}00个。',
    '新建学校普遍配备了创客教室、恒温泳池和智慧图书馆，生均建筑面积比老校区提高{p}%。',
    '针对“入学难”问题，{city}今年首次在{n3}个区试点“学区动态调整”机制。',
    '{school}校长{person}表示，学校将把每周三下午固定为社团活动时间，开设{n4}门兴趣课程。',
    '教育部门同时提醒家长，网上报名将于{m}月底截止，逾期不再补录。',
  ]],
  ['{city}发布人工智能产业新政 最高补贴{n4}00万元', [
    '{city}市{m}月{d}日出台《促进人工智能产业高质量发展的若干措施》，共{n2}条。',
    '新政提出，对新落地的大模型企业，按实际算力投入给予最高{n4}00万元补贴。',
    '目前{city}已集聚人工智能相关企业{w}00余家，去年产业规模同比增长{p}%。',
    '{company}负责人{person}认为，算力补贴将明显降低中小团队的推理成本。',
    '到{y}年，{city}计划建成{n3}个公共算力中心，总算力规模超过{k}000 PFLOPS。',
  ]],
  ['{city}{season}旅游市场火热 接待游客{w}0万人次', [
    '记者从{city}市文旅局获悉，{season}以来全市共接待游客{w}0万人次，同比增长{p}%。',
    '其中，夜间文旅消费占比达到{n2}%，老街夜市、灯光秀和沉浸式演出最受欢迎。',
    '为应对客流高峰，{city}在{n3}个热门景区推行分时预约，并加开旅游专线公交{n4}条。',
    '来自外地的游客{person}说，这次专门带孩子来看非遗展演，“比想象中还热闹”。',
    '文旅部门表示，接下来还将推出{n1}条主题线路，串联起周边的古镇和乡村民宿。',
  ]],
  ['{city}空气质量优良天数比例达{n4}% 创历史新高', [
    '{city}市生态环境局{m}月{d}日通报，今年以来全市空气质量优良天数比例达到{n4}%。',
    'PM2.5 平均浓度为每立方米{n2}微克，同比下降{p}%，为有监测记录以来最低水平。',
    '这得益于{city}持续推进的工业企业深度治理，今年已完成{n3}0家重点企业的超低排放改造。',
    '与此同时，全市新增城市绿地约{k}0公顷，新建口袋公园{n1}个。',
    '环保志愿者{person}说，现在早上跑步能清楚看到远处的山，这在几年前是很难想象的。',
  ]],
  ['{city}{n3}家医院上线“先看病后付费”', [
    '从{m}月{d}日起，{city}共有{n3}家公立医院上线“先看病后付费”服务。',
    '符合条件的参保患者就诊时无需排队缴费，可在离院后{n1}个工作日内通过手机一次性结清。',
    '试点医院数据显示，门诊患者平均就诊时间缩短了{n4}分钟，缴费窗口排队人数减少{p}%。',
    '{hospital}门诊部主任{person}介绍，医院还同步上线了检查报告线上查询和药品配送到家。',
    '医保部门表示，将在{y}年前把这项服务推广到全市所有二级以上医院。',
  ]],
  ['{city}{n2}万亩高标准农田喜获丰收', [
    '时下正值秋收，{city}郊区{n2}万亩高标准农田迎来丰收，平均亩产比去年提高{p}%。',
    '在{village}，{n3}台无人收割机正在田间来回作业，一天可收割{n4}0多亩。',
    '种粮大户{person}算了一笔账：用上智能灌溉和无人机植保后，每亩成本降了约{k}元。',
    '{city}农业农村局表示，今年全市已累计建成高标准农田{w}万亩，占耕地总面积的{n4}%。',
    '下一步，当地将推广“订单农业”模式，帮助农户提前锁定销路和价格。',
  ]],
  ['{city}消费券带动销售额{w}亿元', [
    '{city}市商务局{m}月{d}日公布，本轮消费券活动累计带动社会消费{w}亿元，杠杆率达到1:{n1}。',
    '其中家电、数码和餐饮类消费券最受欢迎，核销率分别达到{n4}%、{p}%和{n2}%。',
    '为方便老年人使用，{city}在{n3}个街道设置了线下领券点，并开通电话预约。',
    '一家商场的负责人{person}说，活动期间客流比平时多了将近一倍，晚上{n1}点后依然很热闹。',
    '商务部门表示，下一阶段将重点支持绿色智能家电以旧换新。',
  ]],
];

function genNews(rnd, k) {
  const [title, sents] = NEWS[(k + Math.floor(rnd() * NEWS.length)) % NEWS.length];
  const city = pick(rnd, CITIES);
  const v = {
    city, person: name(rnd), m: rint(rnd, 1, 12), d: rint(rnd, 1, 28), n1: rint(rnd, 2, 9), n2: rint(rnd, 6, 38),
    n3: rint(rnd, 3, 12), n4: rint(rnd, 15, 95), k: rint(rnd, 12, 68), p: rint(rnd, 8, 46), w: rint(rnd, 12, 95),
    y: rint(rnd, 2027, 2030), dir: pick(rnd, ['东延段', '西延段', '南段', '北段', '一期工程']),
    season: pick(rnd, ['国庆假期', '暑期', '春节假期', '五一假期']), school: `${city}市第${rint(rnd, 2, 40)}中学`,
    company: `${city}${pick(rnd, ['智算', '云图', '星河', '深思', '灵犀'])}科技`, hospital: `${city}市第${rint(rnd, 1, 9)}人民医院`,
    village: `${pick(rnd, ['东', '西', '南', '北', '新', '大'])}${pick(rnd, ['王', '李', '河', '湾', '桥'])}村`,
  };
  const chosen = shuffled(sents, `${k}-${rnd()}`).slice(0, rint(rnd, 4, 5));
  return `【${fill(title, v)}】\n本报${city}${v.m}月${v.d}日电　${chosen.map((s) => fill(s, v)).join('')}\n`;
}

// 数学练习题（带完整解答）
function frac(a, b) {
  const g = (x, y) => (y ? g(y, x % y) : x);
  const d = g(a, b);
  return `${a / d}/${b / d}`;
}
const C2 = (n) => (n * (n - 1)) / 2;
const MATH = [
  (rnd) => {
    let a = rint(rnd, -9, 9) || 2, b = rint(rnd, -9, 9) || -3;
    const s = a + b, p = a * b;
    return [`解方程 x² ${s >= 0 ? '−' : '+'} ${Math.abs(s)}x ${p >= 0 ? '+' : '−'} ${Math.abs(p)} = 0。`,
      `因式分解得 (x ${a >= 0 ? '−' : '+'} ${Math.abs(a)})(x ${b >= 0 ? '−' : '+'} ${Math.abs(b)}) = 0。\n由韦达定理验证：两根之和为 ${s}，两根之积为 ${p}，与系数一致。`, `x₁ = ${a}，x₂ = ${b}`, '一元二次方程'];
  },
  (rnd) => {
    const a1 = rint(rnd, 1, 20), d = rint(rnd, 2, 9), n = rint(rnd, 10, 40);
    const an = a1 + (n - 1) * d;
    return [`等差数列首项为 ${a1}，公差为 ${d}，求前 ${n} 项和。`,
      `第 ${n} 项 aₙ = a₁ + (n − 1)d = ${a1} + ${n - 1} × ${d} = ${an}。\n前 n 项和 Sₙ = n(a₁ + aₙ) / 2 = ${n} × (${a1} + ${an}) / 2 = ${(n * (a1 + an)) / 2}。`, `${(n * (a1 + an)) / 2}`, '数列'];
  },
  (rnd) => {
    const [a, b, c] = pick(rnd, [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10], [9, 12, 15], [20, 21, 29]]);
    return [`直角三角形两条直角边分别为 ${a} 和 ${b}，求斜边长、面积以及斜边上的高。`,
      `由勾股定理，斜边 c = √(${a}² + ${b}²) = √${a * a + b * b} = ${c}。\n面积 S = ${a} × ${b} / 2 = ${(a * b) / 2}。\n斜边上的高 h = 2S / c = ${a * b} / ${c}${(a * b) % c ? '' : ` = ${(a * b) / c}`}。`, `斜边 ${c}，面积 ${(a * b) / 2}`, '几何'];
  },
  (rnd) => {
    const r = rint(rnd, 3, 8), w = rint(rnd, 2, 7), t = r + w;
    return [`袋中有 ${r} 个红球和 ${w} 个白球，从中不放回地任取 2 个，求两个都是红球的概率。`,
      `总取法 C(${t}, 2) = ${C2(t)}，两个都是红球的取法 C(${r}, 2) = ${C2(r)}。\nP = ${C2(r)} / ${C2(t)} = ${frac(C2(r), C2(t))}。`, frac(C2(r), C2(t)), '概率'];
  },
  (rnd) => {
    const x = rint(rnd, -6, 9), y = rint(rnd, -6, 9), a = rint(rnd, 1, 5), b = rint(rnd, 1, 5), c = rint(rnd, 1, 5), d = rint(rnd, -5, -1);
    return [`解方程组：${a}x + ${b}y = ${a * x + b * y}，${c}x ${d < 0 ? '−' : '+'} ${Math.abs(d)}y = ${c * x + d * y}。`,
      `第一个方程乘以 ${c}，第二个方程乘以 ${a}，相减消去 x：\n${b * c - a * d}y = ${c * (a * x + b * y) - a * (c * x + d * y)}，解得 y = ${y}。\n代回第一个方程得 ${a}x = ${a * x + b * y} − ${b * y}，x = ${x}。`, `x = ${x}，y = ${y}`, '方程组'];
  },
  (rnd) => {
    const a = rint(rnd, 1, 4), b = rint(rnd, -5, 5);
    const fmax = 2 * a * a * a + b, fmin = -2 * a * a * a + b;
    return [`求函数 f(x) = x³ − ${3 * a * a}x ${b >= 0 ? '+' : '−'} ${Math.abs(b)} 的单调区间与极值。`,
      `f'(x) = 3x² − ${3 * a * a} = 3(x − ${a})(x + ${a})，驻点为 x = ±${a}。\n当 x < −${a} 或 x > ${a} 时 f'(x) > 0，函数递增；当 −${a} < x < ${a} 时 f'(x) < 0，函数递减。\n极大值 f(−${a}) = ${fmax}，极小值 f(${a}) = ${fmin}。`, `极大值 ${fmax}，极小值 ${fmin}`, '导数'];
  },
];
function genMath(rnd, k) {
  const [q, sol, ans, kind] = pick(rnd, MATH)(rnd);
  return `### 第 ${k} 题（${kind}）\n题目：${q}\n解：${sol}\n答案：${ans}\n`;
}

// 客服对话记录
const ISSUES = [
  ['开机没反应', '长按电源键 10 秒强制重启', '还是没反应'],
  ['充不进电', '换一根数据线和充电头再试一下', '换了线也不行'],
  ['用的时候有异响', '检查一下内部有没有异物并清洁', '清理以后声音小了，但还有'],
  ['少发了配件', '对照说明书核对一下包装里的配件清单', '确实少了一个'],
  ['物流三天没更新', '稍等，我帮您联系快递网点查询', '网点说包裹还在中转站'],
  ['想开发票', '在订单详情页点“申请开票”填写抬头', '找到了，已经提交了'],
  ['收到的颜色不对', '拍一下实物和订单页的照片发给我', '照片已经发过去了'],
  ['想七天无理由退货', '在订单页提交退货申请，选择“上门取件”', '申请提交了'],
];
const FIXES = [
  '我这边直接为您登记换新，新品会在 48 小时内发出，旧的等快递员上门取走就行。',
  '我已经为您申请补发，并补偿一张 {c} 元无门槛优惠券，已经发到您的账户里了。',
  '已经为您加急处理，快递员预计明天下午送达，到时候会提前电话联系您。',
  '退款会在商品寄回签收后 1~3 个工作日原路退回，运费由我们承担。',
];
function genChat(rnd, k) {
  const [sku, prod] = pick(rnd, PRODUCTS);
  const [issue, step, result] = pick(rnd, ISSUES);
  const oid = `SO-2026${pad(rint(rnd, 1, 11))}${pad(rint(rnd, 1, 28))}-${pad(rint(rnd, 1, 99999), 5)}`;
  return [
    `### 对话 #${k}`,
    `用户：你好，我${rint(rnd, 2, 9)}天前买的${prod}${issue}，怎么办？`,
    `客服小橙：您好，我是客服小橙，非常抱歉给您带来不便！麻烦提供一下订单号，我马上帮您查。`,
    `用户：订单号是 ${oid}。`,
    `客服小橙：已经查到了，您购买的是${prod}（${sku}），目前订单状态是${pick(rnd, ['已签收', '已发货', '已签收'])}。麻烦您先${step}。`,
    `用户：${result}。`,
    `客服小橙：${fill(pick(rnd, FIXES), { c: pick(rnd, [10, 20, 30, 50]) })}`,
    `用户：${pick(rnd, ['好的，谢谢', '那太好了，辛苦了', '行，那我等着', '可以，麻烦你了'])}。`,
    `客服小橙：不客气！还有其他问题随时找我，祝您生活愉快～`,
    '',
  ].join('\n');
}

// ---------------- 8 个测试领域
// fac：该领域每个 token 大约对应多少字符，相对代码语料的倍数，用来把资料长度控制在目标 token 数附近
const DOMAINS = [
  {
    id: 'py', name: 'Python 代码', doc: 'Python 题库', fac: 1,
    gen: (n, s) => buildCorpus(n, s),
    task: '基于上面的题库挑选 8 道题，逐题给出：题意复述、解题思路、带类型注解和注释的完整 Python 实现、时间与空间复杂度分析，以及不少于 6 个 pytest 测试用例。',
  },
  {
    id: 'ts', name: '前端 TS', doc: '前端移植题库', fac: 1,
    gen: (n, s) => buildCorpus(n, s + '-ts'),
    task: '把上面题库中的 10 道题移植为 TypeScript：每道题包含严格的类型定义、JSDoc 注释、完整实现和 Vitest 测试；最后用 React + TypeScript 写一个展示这些题目及运行结果的页面组件。',
  },
  {
    id: 'json', name: 'JSON 结构化', doc: '电商订单表', fac: 0.85,
    gen: (n, s) => fromGen(genOrder, n, s),
    task: '把上面的订单逐条转换成规范的 JSON 数组输出：每条包含 order_id、customer、items（每项补充 subtotal 字段）、coupon、total、status、paid_at，并新增 risk_level 字段（low / medium / high，自行判断）。按原顺序输出全部订单，不要省略任何一条，不要输出 JSON 以外的任何内容。',
  },
  {
    id: 'trans', name: '中译英', doc: '中文新闻稿', fac: 0.42,
    gen: (n, s) => fromGen(genNews, n, s),
    task: '把上面的中文新闻稿按顺序逐篇翻译成地道、正式的英文新闻稿，保留标题、电头、日期和所有数字，不要省略任何一篇，也不要添加评论。',
  },
  {
    id: 'math', name: '数学推导', doc: '数学练习题', fac: 0.55,
    gen: (n, s) => fromGen(genMath, n, s),
    task: '从上面的练习题中依次取题，逐题写出完整严谨的推导过程（每一步都写明依据），给出最终答案，再为每道题补充一道同类型的变式题并完整解答。',
  },
  {
    id: 'en', name: '英文写作', doc: '英文需求文档', fac: 1.15,
    gen: (n, s) => fromItems(EN_ITEMS, n, s),
    task: 'Based on the requirement list above, write a long English technical blog post titled "Lessons from a Thousand Small Programming Tasks". Cover recurring patterns, common pitfalls, testing strategies and code review habits, with many concrete examples drawn from the list. Write in fluent, natural English.',
  },
  {
    id: 'zh', name: '中文长文', doc: '中文新闻稿', fac: 0.42,
    gen: (n, s) => fromGen(genNews, n, s + '-zh'),
    task: '以上面的新闻稿为素材，写一篇完整的中文长篇深度报道：包含标题、导语、多个小标题章节、人物采访、数据分析和结尾评论，文字生动流畅。',
  },
  {
    id: 'chat', name: '客服对话', doc: '客服对话记录', fac: 0.42,
    gen: (n, s) => fromGen(genChat, n, s),
    task: '你是电商平台的客服“小橙”。参照上面对话记录的风格，续写 20 段全新的完整客服对话，每段至少 8 轮，覆盖不同的商品和问题，用户和客服的语气都要自然。',
  },
];

const LONG_SUFFIX = '\n\n要求：内容务必详尽完整，不要省略，不要中途总结或提前结束，篇幅越长越好。';

/**
 * 生成第 i 路的领域资料（system 提示词）。
 * 读取速度测试和并发生成测试共用同一份，后者可以直接命中前者写入的前缀缓存。
 */
function buildDomainDoc(i, targetTokens, charsPerToken, seed) {
  const domain = DOMAINS[i % DOMAINS.length];
  const head = `[session ${seed}]\n以下是「${domain.doc}」资料，请基于这些资料完成用户的任务。\n\n<material>\n`;
  const foot = '\n</material>\n';
  const chars = Math.max(2000, Math.round(targetTokens * charsPerToken * domain.fac) - head.length - foot.length);
  return { domain, system: head + domain.gen(chars, `lane-${i}`) + foot };
}

// 校准分词比例用的代码语料包装
const HEADER =
  '你是一名资深软件工程师与代码评审专家。下面是一个 Python 编程题库（来自 HumanEval 与 MBPP），' +
  '每道题包含题目描述、参考实现与测试用例。请基于该题库回答用户的问题。\n\n<code_bank>\n';
const FOOTER = '\n</code_bank>\n';

const PING_USER = 'ping，请只回复 pong。';
const PREFILL_USER = '请用一句话概括上面资料的主题。';

// 单发峰值：短提示词写代码。代码最容易被 MTP / 投机解码猜中，测的是速度上限
const SINGLE_SYSTEM = '你是一名资深 Python 工程师。';
const SINGLE_TASK =
  '用 Python 从零实现一个功能完整的 LRU 缓存库：包含带类型注解的 LRUCache 类（get、put、delete、resize、命中率统计）、' +
  '线程安全版本、TTL 过期支持、详细的 docstring 和注释，以及覆盖全部功能的 pytest 测试用例。' + LONG_SUFFIX;

module.exports = {
  ITEMS,
  TOTAL_CHARS,
  HEADER,
  FOOTER,
  PING_USER,
  PREFILL_USER,
  DOMAINS,
  LONG_SUFFIX,
  SINGLE_SYSTEM,
  SINGLE_TASK,
  buildCorpus,
  buildDomainDoc,
};
