<template>
  <el-button @click="visible = true">扫描优惠码</el-button>
  <el-dialog v-model="visible" title="扫描优惠码" width="90%" :close-on-click-modal="false">
    <p>扫描全部已收邮件中的 chatgpt.com/p/ 链接，自动去重。不访问兑换链接，不验证有效性。</p>
    <el-button :disabled="running" @click="scan">{{ scanned ? '重新扫描' : '开始扫描' }}</el-button>
    <el-button v-if="running" @click="stopped = true">停止</el-button>
    <el-button :disabled="!rows.length" @click="copyAll">复制全部优惠码</el-button>
    <p role="status">{{ status }} 已扫描 {{ scanned }} 封，发现 {{ rows.length }} 个优惠码。</p>
    <el-input v-model="query" placeholder="筛选优惠码或收件邮箱" clearable />
    <el-table :data="filtered" max-height="450" empty-text="暂无匹配优惠码">
      <el-table-column prop="code" label="优惠码" min-width="200" />
      <el-table-column prop="mailboxes" label="收件邮箱" min-width="220" />
      <el-table-column prop="subject" label="邮件主题" min-width="180" />
      <el-table-column prop="time" label="收到时间（原始时间）" min-width="180" />
      <el-table-column label="状态" width="90"><template #default>未验证</template></el-table-column>
      <el-table-column label="操作" width="90"><template #default="{row}"><el-button link @click="copy(row.code)">复制</el-button></template></el-table-column>
    </el-table>
  </el-dialog>
</template>

<script setup>
import {computed, onBeforeUnmount, ref} from 'vue'
import {ElMessage} from 'element-plus'
import {allEmailList} from '@/request/all-email.js'
import {extractPromoCodes} from './promo-codes.js'

const visible = ref(false), running = ref(false), stopped = ref(false)
const scanned = ref(0), rows = ref([]), query = ref(''), status = ref('尚未扫描。')
const filtered = computed(() => rows.value.filter(row =>
  `${row.code} ${row.mailboxes}`.toLowerCase().includes(query.value.trim().toLowerCase())))
onBeforeUnmount(() => { stopped.value = true })

async function copy(value) {
  try { await navigator.clipboard.writeText(value); ElMessage.success('已复制') }
  catch { ElMessage.error('复制失败，请手动选择优惠码复制') }
}
function copyAll() { return copy(filtered.value.map(row => row.code).join('\n')) }

async function scan() {
  if (running.value) return
  running.value = true; stopped.value = false; scanned.value = 0; rows.value = []
  status.value = '扫描中，请保持页面打开。'
  const found = new Map()
  let cursor = 0
  try {
    while (!stopped.value) {
      const result = await allEmailList({emailId: cursor, size: 50, full: 1, type: 'receive', timeSort: 0})
      if (stopped.value) break
      const list = result.list
      if (!Array.isArray(list)) throw new Error('邮件接口响应异常')
      if (!list.length) { status.value = '扫描完成。'; break }
      for (const mail of list) {
        for (const code of extractPromoCodes(mail.text, mail.content)) {
          const address = mail.toEmail || mail.userEmail || ''
          if (!found.has(code)) found.set(code, {
            code, addresses: new Set(), subject: mail.subject || '', time: mail.createTime || ''
          })
          found.get(code).addresses.add(address)
        }
      }
      scanned.value += list.length
      rows.value = Array.from(found.values(), row => ({...row, mailboxes: [...row.addresses].join(', ')}))
      const next = Math.min(...list.map(mail => Number(mail.emailId)))
      if (!Number.isSafeInteger(next) || next <= 0 || (cursor && next >= cursor)) {
        throw new Error('分页游标异常，已停止以避免重复扫描')
      }
      cursor = next
    }
    if (stopped.value) status.value = '已停止，保留当前结果。'
  } catch (error) {
    status.value = `扫描未完成，已保留部分结果。${error.message || '请稍后重试'}`
  } finally { running.value = false }
}
</script>
