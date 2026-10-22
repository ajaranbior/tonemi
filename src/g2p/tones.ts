import { pinyin } from 'pinyin-pro'
import type { Tone } from '../analysis/tones'

export { markTone } from './marks'

/**
 * Common words whose last syllable is neutral in Mainland Putonghua
 * (现代汉语词典) but which pinyin-pro gives a full tone.
 */
const NEUTRAL_FINAL = new Set(
  ('朋友 时候 舒服 告诉 清楚 明白 意思 地方 事情 东西 麻烦 客气 打扮 收拾 窗户 玻璃 葡萄 消息 学生 ' +
    '名字 先生 脑袋 热闹 商量 打算 骆驼 姑娘 晚上 早上 爸爸 妈妈 哥哥 姐姐 弟弟 妹妹 爷爷 奶奶 ' +
    '谢谢 看看 说说 想想 试试 聪明 漂亮 便宜 暖和 喜欢 认识 休息 衣服 豆腐 头发 耳朵 眼睛 钥匙 ' +
    '亲戚 包袱 衣裳 规矩 糊涂 机灵 结实 精神 苗条 凉快 痛快 舌头 石头 木头 馒头 枕头 ' +
    '尾巴 嘴巴 下巴 篱笆 点心 买卖 生意 本事 主意 部分 道理 力气 志气 大夫 丈夫 师傅 媳妇 ' +
    '月饼 云彩 窝囊 牌楼 匀称 招呼 张罗 折腾 琢磨 摆布 打听 打量 合同 胡琴 护士 ' +
    '狐狸 葫芦 喇叭 篮子 老婆 冷清 力量 利害 厉害 连累 粮食 溜达 萝卜 啰唆 码头 忙活 ' +
    '眉毛 迷糊 名堂 蘑菇 模糊 牡丹 难为 念叨 娘家 女婿 疟疾 暖和 牌子 盘算 朋友 脾气 ' +
    '屁股 便宜 漂亮 婆家 铺盖 欺负 前头 亲家 勤快 清楚 拳头 热和 人家 认得 任务 扫帚 ' +
    '少爷 舍得 生日 时候 实在 世故 事情 收成 叔叔 舒坦 爽快 算计 岁数 太太 特务 跳蚤 ' +
    '铁匠 头发 妥当 唾沫 挖苦 晚上 尾巴 委屈 位置 温和 稳当 窝囊 稀罕 媳妇 喜欢 下巴 ' +
    '吓唬 先生 显得 相声 消息 笑话 谢谢 心思 星星 行李 兄弟 秀才 学生 学问 丫头 衙门 ' +
    '哑巴 胭脂 烟筒 眼睛 秧歌 养活 吆喝 妖精 钥匙 椰子 衣服 衣裳 意思 应酬 冤枉 院子 ' +
    '月亮 云彩 运气 在乎 咱们 早上 怎么 扎实 眨巴 栅栏 宅子 寨子 张罗 丈夫 帐篷 丈人 ' +
    '招牌 折腾 这个 芝麻 知识 指甲 指头 主意 转悠 庄稼 壮实 状元 字号 自在 祖宗 嘴巴 ' +
    '作坊 琢磨 那个 什么 多么 怎么 这么 那么 东边 西边 南边 北边 上边 下边 里边 外边 ' +
    '前边 后边 左边 右边 里头 外头 上头 下头 后头 前头').split(/\s+/),
)

/** Particles and suffixes that are neutral as the last syllable of a word. */
const NEUTRAL_SUFFIX = new Set([...'子们么的了着过吗呢吧啊呀嘛'])

/** Lexical (citation) tones of a string of Chinese characters, word-aware. */
export function lexicalTones(text: string): Tone[] {
  const syl = pinyin(text, { toneType: 'num', type: 'array', toneSandhi: false })
  const tones = syl.map((p) => Number(p.slice(-1)) as Tone)
  const chars = [...text]
  if (chars.length >= 2) {
    const last = chars.length - 1
    if (NEUTRAL_FINAL.has(text) || NEUTRAL_SUFFIX.has(chars[last])) tones[last] = 0
    // Reduplicated syllables (妈妈, 看看): second is neutral.
    if (chars.length === 2 && chars[0] === chars[1]) tones[1] = 0
  }
  return tones
}

const SENTENCE_NEUTRAL = new Set([...'们么的了着吗呢吧啊呀嘛'])

/**
 * Tones for running text (a subtitle line): lexical tones with neutral words
 * found by scanning, then sandhi. Non-Chinese characters get no tone.
 */
export function sentenceTones(text: string): { chars: string[]; tones: (Tone | null)[]; approximate: boolean } {
  const chars = [...text]
  const tones: (Tone | null)[] = chars.map(() => null)
  let approximate = false
  const han = /\p{Script=Han}/u
  let i = 0
  while (i < chars.length) {
    if (!han.test(chars[i])) { i++; continue }
    let j = i
    while (j < chars.length && han.test(chars[j])) j++
    const run = chars.slice(i, j)
    const lex = pinyin(run.join(''), { toneType: 'num', type: 'array', toneSandhi: false }).map((p) => Number(p.slice(-1)) as Tone)
    for (let k = 0; k < run.length; k++) {
      if (k > 0 && (NEUTRAL_FINAL.has(run[k - 1] + run[k]) || SENTENCE_NEUTRAL.has(run[k]))) lex[k] = 0
      if (k > 0 && run[k] === '子' && lex[k] === 3) lex[k] = 0
    }
    const s = surfaceTones(run, lex)
    approximate ||= s.approximate
    s.tones.forEach((t, k) => (tones[i + k] = t))
    i = j
  }
  return { chars, tones, approximate }
}

export interface SurfaceTones {
  tones: Tone[]
  /** True when a 3-3-3+ chain was resolved without knowing the word structure. */
  approximate: boolean
}

/**
 * Apply Mainland tone sandhi: 一, 不 and 3rd-tone chains.
 * Runs of 3+ third tones default to all-but-last → 2, flagged as approximate.
 */
export function surfaceTones(chars: string[], lexical: Tone[]): SurfaceTones {
  const t = lexical.slice()
  const next = (i: number) => (i + 1 < t.length ? lexical[i + 1] : null)

  for (let i = 0; i < t.length; i++) {
    const n = next(i)
    if (chars[i] === '不' && lexical[i] === 4 && n === 4) t[i] = 2
    if (chars[i] === '一' && lexical[i] === 1) {
      const prev = chars[i - 1]
      if (prev === '第' || n === null || n === 0) continue
      if (prev && prev === chars[i + 1]) t[i] = 0 // 看一看
      else t[i] = n === 4 ? 2 : 4
    }
  }

  let approximate = false
  let i = 0
  while (i < t.length) {
    if (t[i] !== 3) { i++; continue }
    let j = i
    while (j < t.length && t[j] === 3) j++
    if (j - i >= 2) {
      for (let k = i; k < j - 1; k++) t[k] = 2
      if (j - i >= 3) approximate = true
    }
    i = j
  }
  return { tones: t, approximate }
}
