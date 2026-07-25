import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openCleanHome(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /开始.*第一部.*小说/ })).toBeVisible()
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: '+ 新建项目', exact: true }).click()
  await page.getByPlaceholder('如：《剑出山门》').fill(name)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
  await expect(page.getByTitle(name)).toBeVisible()
}

function sidebarButton(page: Page, name: string) {
  return page.getByRole('navigation')
    .getByText(name, { exact: true })
    .locator('xpath=ancestor::button[1]')
}

async function openSidebarLeaf(page: Page, branchName: string, leafName: string) {
  const leaf = sidebarButton(page, leafName)
  const branch = sidebarButton(page, branchName)
  // 对真实 branch 做一次显式归一：若点击后叶子消失，说明刚才是关闭，再点一次打开。
  // 「创作区」是 section 标题而非按钮，branch.count() 为 0，叶子本身已常驻渲染。
  if (await branch.count() > 0) {
    await branch.click()
    if (await leaf.count() === 0) await branch.click()
  }
  await expect(leaf).toHaveCount(1)
  await leaf.scrollIntoViewIfNeeded()
  await leaf.click()
}

async function expectInputValue(page: Page, value: string) {
  await expect.poll(() => page.locator('input').evaluateAll(
    (inputs, expected) => inputs.some(input => input.value === expected),
    value,
  )).toBe(true)
}

async function expectNumericInputValue(locator: ReturnType<Page['getByPlaceholder']>, expected: number) {
  await expect.poll(async () => Number((await locator.inputValue()).replaceAll(',', ''))).toBe(expected)
}

async function createBookWithSavedChapter(page: Page, projectName: string, chapterText: string) {
  await openCleanHome(page)
  await createProject(page, projectName)
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expectInputValue(page, '第1卷')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expectInputValue(page, '第1章')
  await page.getByTitle('编辑章节').click()

  const editor = page.locator('.tiptap-editor')
  await expect(editor).toBeVisible()
  await editor.fill(chapterText)
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
}

test('新用户可创建项目并进入工作区', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E 创建项目')
  await expect(page.getByRole('button', { name: '大纲', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '章节', exact: true })).toBeVisible()
})

test('人文知识主入口可保存拆分概述，并安全关联与断开城池地点', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E 世界知识归并')

  await sidebarButton(page, '重要地点').click()
  await expect(page.getByRole('heading', { name: '📍 重要地点' })).toBeVisible()
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  await page.locator('input[value="新地点"]').fill('雁门关')
  await page.getByRole('heading', { name: '📍 重要地点' }).click()
  await expect(page.getByText('雁门关', { exact: true })).toBeVisible()

  await sidebarButton(page, '人文环境').click()
  await expect(page.getByRole('heading', { name: '🏛️ 人文环境与社会' })).toBeVisible()
  await expect(page.getByRole('button', { name: /打开正式历史年表/ })).toBeVisible()
  await page.getByRole('button', { name: /打开正式历史年表/ }).click()
  await expect(page.getByRole('heading', { name: '📜 历史年表与时间线' })).toBeVisible()
  await sidebarButton(page, '人文环境').click()
  await page.getByRole('button', { name: /政治制度/ }).click()
  await page.getByText('政体、官制、法律、军事、外交、权力主体与阶层结构').last().click()
  await page.locator('textarea').last().fill('议政院与六部共同治理')

  await page.getByRole('button', { name: /城池重镇/ }).click()
  await expect(page.getByRole('button', { name: /新建词条/ })).toBeVisible()
  await page.getByRole('button', { name: /新建词条/ }).click()
  await page.getByPlaceholder('名称', { exact: true }).fill('雁门城')
  await page.getByLabel('城池重要地点').selectOption({ label: '雁门关' })

  await page.reload()
  await sidebarButton(page, '人文环境').click()
  await page.getByRole('button', { name: /政治制度/ }).click()
  await expect(page.getByText('议政院与六部共同治理', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /城池重镇/ }).click()
  await page.getByText('雁门城', { exact: true }).click()
  await expect(page.getByLabel('城池重要地点')).toHaveValue(/\d+/)

  await sidebarButton(page, '重要地点').click()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  await page.getByText('雁门关', { exact: true }).click()
  await page.getByRole('button', { name: '删除地点', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('雁门关', { exact: true })).toHaveCount(0)

  await sidebarButton(page, '人文环境').click()
  await page.getByRole('button', { name: /城池重镇/ }).click()
  await page.getByText('雁门城', { exact: true }).click()
  await expect(page.getByLabel('城池重要地点')).toHaveValue('')
})

test('建卷建章、保存正文、刷新恢复并导出正文与隐私诊断', async ({ page }) => {
  const projectName = 'E2E 正文往返'
  const chapterText = '林舟推开旧城门，确认正文已经写入并保存。'
  await createBookWithSavedChapter(page, projectName, chapterText)

  await page.reload()
  await page.getByRole('button', { name: '章节', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText(chapterText)

  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  const markdownDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 Markdown', exact: true }).click()
  const markdown = await markdownDownload
  const markdownPath = await markdown.path()
  expect(markdownPath).not.toBeNull()
  expect(await readFile(markdownPath!, 'utf8')).toContain(chapterText)

  const diagnosticDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载诊断信息', exact: true }).click()
  const diagnostic = await diagnosticDownload
  expect(diagnostic.suggestedFilename()).toMatch(/^storyforge-diagnostics-\d{4}-\d{2}-\d{2}\.json$/)
  const diagnosticPath = await diagnostic.path()
  expect(diagnosticPath).not.toBeNull()
  const diagnosticText = await readFile(diagnosticPath!, 'utf8')
  const report = JSON.parse(diagnosticText) as {
    format: string
    privacy: { includesRecordContents: boolean; includesApiKeys: boolean }
  }
  expect(report.format).toBe('storyforge-local-diagnostics')
  expect(report.privacy.includesRecordContents).toBe(false)
  expect(report.privacy.includesApiKeys).toBe(false)
  expect(diagnosticText).not.toContain(projectName)
  expect(diagnosticText).not.toContain(chapterText)
})

test('完整 JSON 导出后可重新导入且正文不丢', async ({ page }) => {
  const projectName = 'E2E JSON 往返'
  const chapterText = '这段正文必须跟随完整 JSON 备份恢复。'
  await createBookWithSavedChapter(page, projectName, chapterText)
  await page.getByRole('button', { name: '数据管理', exact: true }).click()

  const exportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const backup = await exportDownload
  const backupPath = await backup.path()
  expect(backupPath).not.toBeNull()

  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入 JSON', exact: true }).click()
  await (await fileChooser).setFiles(backupPath!)
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
  await page.getByRole('button', { name: '章节', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText(chapterText)
})

test('手动快照可恢复为新项目且不覆盖原项目', async ({ page }) => {
  const projectName = 'E2E 快照恢复'
  await createBookWithSavedChapter(page, projectName, '快照中的正文内容。')
  await page.getByRole('button', { name: '版本历史', exact: true }).click()
  await page.getByPlaceholder('快照名称（可选 — 留空使用时间戳）').fill('E2E 手动快照')
  await page.getByRole('button', { name: '创建快照', exact: true }).click()
  await expect(page.getByText('E2E 手动快照')).toBeVisible()

  const originalWorkspaceUrl = page.url()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '恢复为新项目', exact: true }).click()
  await expect(page).not.toHaveURL(originalWorkspaceUrl)
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(page.getByRole('heading', { name: /共有 2 部作品/ })).toBeVisible()
  await expect(page.getByText(projectName, { exact: true })).toBeVisible()
  await expect(page.getByText(`${projectName}（导入）`, { exact: true })).toBeVisible()
})

test('删除项目经过双重安全门且不影响其它项目', async ({ page }) => {
  const deletedProject = 'E2E 待删除项目'
  const keptProject = 'E2E 保留项目'
  await createBookWithSavedChapter(page, deletedProject, '删除项目时应由注册表级联清理的正文。')
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await createProject(page, keptProject)
  await page.getByRole('button', { name: '返回首页', exact: true }).click()

  const deletedRow = page.getByText(deletedProject, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await deletedRow.getByTitle('删除').click()
  await expect(deletedRow.getByRole('button', { name: '确认', exact: true })).toBeVisible()
  await expect(page.getByText(deletedProject, { exact: true })).toBeVisible()

  await deletedRow.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('heading', { name: '危险操作:删除项目' })).toBeVisible()
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('heading', { name: '是否立即下载备份(JSON 文件到本地)?' })).toBeVisible()
  await page.getByRole('button', { name: '已备份，继续', exact: true }).click()

  await expect(page.getByText(deletedProject, { exact: true })).toHaveCount(0)
  await expect(page.getByText(keptProject, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /共有 1 部作品/ })).toBeVisible()
})

test('取消删除安全门后项目与正文都保留', async ({ page }) => {
  const projectName = 'E2E 取消删除'
  const chapterText = '取消危险操作后这段正文必须仍然存在。'
  await createBookWithSavedChapter(page, projectName, chapterText)
  await page.getByRole('button', { name: '返回首页', exact: true }).click()

  const projectRow = page.getByText(projectName, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await projectRow.getByTitle('删除').click()
  await projectRow.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('heading', { name: '危险操作:删除项目' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()

  await expect(page.getByText(projectName, { exact: true })).toBeVisible()
  await page.getByText(projectName, { exact: true }).click()
  await page.getByRole('button', { name: '章节', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText(chapterText)
})

test('上下文窗口与四类任务模型路由跨模块和刷新保留', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E AI 配置持久化')
  await sidebarButton(page, '设置').click()

  const contextWindow = page.getByPlaceholder('本地/自定义模型请按实际填写，如 131072；留空 = 用内置预设')
  await contextWindow.fill('2,100,000')
  await expect(page.getByText('2,100,000 token', { exact: false })).toBeVisible()
  await expect(page.getByText('已自动保存到当前配置', { exact: true })).toBeVisible()

  await sidebarButton(page, '数据管理').click()
  await sidebarButton(page, '设置').click()
  await expectNumericInputValue(contextWindow, 2_100_000)

  await page.getByRole('button', { name: '＋ 保存当前为预设', exact: true }).click()
  const presetName = page.getByPlaceholder('预设名称，如「DeepSeek 主力」')
  await presetName.fill('创作模型')
  await presetName.locator('xpath=..').getByRole('button', { name: '保存', exact: true }).click()

  await page.getByPlaceholder('或手动输入模型名（列表中没有的型号）').fill('deepseek-review')
  await page.getByRole('button', { name: '另存为新预设', exact: true }).click()
  await presetName.fill('审查模型')
  await presetName.locator('xpath=..').getByRole('button', { name: '保存', exact: true }).click()

  await page.getByLabel('创作生成模型预设').selectOption({ label: '创作模型 · deepseek/deepseek-chat' })
  await page.getByLabel('结构提取模型预设').selectOption({ label: '创作模型 · deepseek/deepseek-chat' })
  await page.getByLabel('分析总结模型预设').selectOption({ label: '审查模型 · deepseek/deepseek-review' })
  await page.getByLabel('审查校验模型预设').selectOption({ label: '审查模型 · deepseek/deepseek-review' })

  await page.reload()
  await sidebarButton(page, '设置').click()
  await expectNumericInputValue(contextWindow, 2_100_000)
  await expect(page.getByLabel('创作生成模型预设')).toHaveValue(await page.getByLabel('结构提取模型预设').inputValue())
  await expect(page.getByLabel('分析总结模型预设')).toHaveValue(await page.getByLabel('审查校验模型预设').inputValue())
  await expect(page.getByLabel('创作生成模型预设').locator('option:checked')).toContainText('创作模型')
  await expect(page.getByLabel('分析总结模型预设').locator('option:checked')).toContainText('审查模型')
})

test('本地 OpenAI 兼容服务可刷新并保存模型列表', async ({ page }) => {
  await page.route('http://localhost:1234/v1/models', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'qwen-local' }, { id: 'deepseek-local' }] }),
    })
  })
  await openCleanHome(page)
  await createProject(page, 'E2E 本地模型刷新')
  await sidebarButton(page, '设置').click()

  const provider = page.locator('label:has-text("提供商") + select')
  await provider.selectOption('ollama')
  const baseUrl = page.locator('label:has-text("Base URL") + input')
  await baseUrl.fill('http://localhost:1234/v1/models')
  await page.getByRole('button', { name: '刷新模型', exact: true }).click()

  const modelList = page.getByLabel('服务返回的模型列表')
  await expect(modelList).toBeVisible()
  await expect(modelList.locator('option')).toHaveCount(3)
  await modelList.selectOption('qwen-local')
  await expect(baseUrl).toHaveValue('http://localhost:1234/v1')

  await page.reload()
  await sidebarButton(page, '设置').click()
  await expect(page.locator('input[placeholder="手动输入模型名"]')).toHaveValue('qwen-local')
  await expect(baseUrl).toHaveValue('http://localhost:1234/v1')
})

test('外部文档词条先形成带证据候选，作者确认后才进入 Codex', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'codex-import-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              worldview: {},
              characters: [],
              outline: [],
              codexCandidates: [{
                categoryRef: 'builtin:city',
                name: '临渊城',
                summary: '扼守海峡的贸易重镇',
                description: '常住十万人，万舟汇聚。',
                fields: { scale: '十万人', economy: '海贸' },
                tags: ['港城', '贸易'],
                confidence: 0.94,
                evidenceQuote: '临渊城扼守海峡',
              }],
              writingTechniques: {},
            }),
          },
        }],
        usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
      }),
    })
  })
  await openCleanHome(page)
  await createProject(page, 'E2E 词条导入审查')

  await sidebarButton(page, '文档解析').click()
  await page.getByPlaceholder(/把文档内容粘贴在这里/).fill(
    '临渊城扼守海峡，常住十万人，万舟汇聚，是北境最大的贸易港。',
  )
  await page.getByRole('button', { name: '开始解析', exact: true }).click()
  await page.getByRole('button', { name: /导入当前项目（1 块）/ }).click()

  await expect(page.getByRole('heading', { name: '✓ 全部解析完成' })).toBeVisible()
  await expect(page.getByText('1 条 Codex 候选等待作者审查')).toBeVisible()
  await page.getByRole('button', { name: '审查并选择', exact: true }).click()
  await expect(page.getByText('逐字证据：')).toBeVisible()
  await expect(page.getByText(/第 1 块“临渊城扼守海峡”/)).toBeVisible()
  await page.locator('input[value="临渊城"]').fill('新临渊城')
  await page.getByRole('button', { name: '确认导入 1 条', exact: true }).click()

  await expect(page.getByText(/词条审查已完成：新增 1/)).toBeVisible()
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await sidebarButton(page, '人文环境').click()
  await page.getByRole('button', { name: /城池重镇/ }).click()
  await expect(page.getByText('新临渊城', { exact: true })).toBeVisible()
})

test('真实章节入口可打开五阶段工坊并预览首节点最终提示词', async ({ page }) => {
  await createBookWithSavedChapter(
    page,
    'E2E 透明章纲工坊',
    '林舟已经拿着青铜钥匙来到密室门前。',
  )

  await page.getByTitle('五阶段章纲工坊').click()
  await expect(page.getByRole('heading', { name: /五阶段章纲工坊/ })).toBeVisible()
  await expect(page.getByText('预计调用 5 次模型', { exact: false })).toBeVisible()
  await expect(page.getByText('当前：现状扫描', { exact: false })).toBeVisible()
  await expect(page.getByText('正在按注册表装配本章证据')).toHaveCount(0)

  await page.getByLabel('每个节点发送前预览/编辑最终消息（一次性，不保存）').check()
  await page.getByRole('button', { name: '生成本步', exact: true }).click()

  await expect(page.getByTestId('prompt-preview-gate')).toBeVisible()
  await expect(page.getByText('最终发送内容', { exact: true })).toBeVisible()
  const prompts = page.getByTestId('prompt-preview-gate').locator('textarea')
  await expect(prompts).toHaveCount(2)
  await expect(prompts.nth(0)).toContainText('现状扫描')
  await expect(prompts.nth(1)).toContainText('第1章')
  await expect(page.getByTestId('prompt-preview-gate').getByText(
    '不写回模板或作品资料',
    { exact: false },
  )).toBeVisible()
})

test('真实世界观入口可维护修炼 DAG 并关联角色境界', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'cultivation-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const userMessage = request.messages?.find(message => message.role === 'user')?.content ?? ''
    const registryText = userMessage.match(
      /【角色与修炼体系闭集】\n([\s\S]*?)\n\n【章节】/,
    )?.[1]
    const registry = registryText ? JSON.parse(registryText) as Array<{
      characterId: number
      cultivationSystemId: number
      stages: Array<{ id: string; name: string }>
    }> : []
    const subject = registry[0]
    const stage = subject?.stages.find(item => item.name === '筑基境')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              events: subject && stage ? [{
                characterId: subject.characterId,
                cultivationSystemId: subject.cultivationSystemId,
                stageId: stage.id,
                transition: 'enter',
                trigger: '生死关头凝成道基',
                quote: '在生死关头凝成道基，正式踏入筑基境',
              }] : [],
            }),
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      }),
    })
  })
  await openCleanHome(page)
  await createProject(page, 'E2E 修炼体系闭环')

  await openSidebarLeaf(page, '世界观', '世界起源')
  await page.getByRole('button', { name: '力量体系', exact: true }).click()
  await expect(page.getByRole('heading', { name: '修炼体系', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新增体系', exact: true }).click()
  await page.getByPlaceholder('如：剑修、武夫、召唤师').fill('剑修')
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('剑修', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '添加第一个起始境界', exact: true }).click()
  const stageNameField = page.getByText('境界名称', { exact: true }).locator('..')
  await stageNameField.getByText('新境界', { exact: true }).click()
  await stageNameField.locator('input').fill('炼体境')
  await stageNameField.locator('input').press('Enter')
  await expect(page.getByText('炼体境', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '添加后续境界', exact: true }).click()
  await stageNameField.getByText('新境界', { exact: true }).click()
  await stageNameField.locator('input').fill('筑基境')
  await stageNameField.locator('input').press('Enter')
  await expect(page.getByText('← 炼体境', { exact: true })).toBeVisible()

  await openSidebarLeaf(page, '角色设计', '角色生成')
  await page.getByRole('button', { name: /新建角色/ }).click()
  await page.getByRole('button', { name: '主要', exact: true }).click()
  await page.getByRole('button', { name: '守序善良', exact: true }).click()
  await page.getByRole('button', { name: '创建并分流', exact: true }).click()

  await page.getByLabel('主修体系').selectOption({ label: '剑修' })
  await page.getByLabel('当前设定境界').selectOption({ label: '筑基境' })
  await expect(page.getByLabel('主修体系').locator('option:checked')).toHaveText('剑修')
  await expect(page.getByLabel('当前设定境界').locator('option:checked')).toHaveText('筑基境')

  await page.reload()
  await openSidebarLeaf(page, '角色设计', '角色生成')
  await page.getByRole('button', { name: /新角色/ }).last().click()
  await expect(page.getByLabel('主修体系').locator('option:checked')).toHaveText('剑修')
  await expect(page.getByLabel('当前设定境界').locator('option:checked')).toHaveText('筑基境')

  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expectInputValue(page, '第1卷')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expectInputValue(page, '第1章')
  await page.getByTitle('编辑章节').click()
  const editor = page.locator('.tiptap-editor')
  await editor.fill('林舟与强敌鏖战三日，最终在生死关头凝成道基，正式踏入筑基境，剑气照亮整座山谷。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()

  await openSidebarLeaf(page, '创作区', '修炼进度')
  await expect(page.getByRole('heading', { name: '修炼进度', exact: true })).toBeVisible()
  await expect(page.getByText('正文尚无已确认境界', { exact: true })).toBeVisible()
  await expect(page.getByText('角色卡设定：筑基境', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '分析本章', exact: true }).click()
  await expect(page.getByText('发现 1 条可靠候选，请逐条确认。', { exact: true })).toBeVisible()
  await expect(page.getByText('生死关头凝成道基', { exact: true })).toBeVisible()
  await page.getByLabel('确认修炼候选').click()
  await expect(page.getByText('正文当前：筑基境', { exact: true })).toBeVisible()
  await expect(page.getByText('已确认并写入修炼历程。', { exact: true })).toBeVisible()

  const feedbackToggle = page.getByLabel('反哺后续写作（默认关闭）')
  await feedbackToggle.click()
  await expect(feedbackToggle).toBeChecked()
  await page.reload()
  await openSidebarLeaf(page, '创作区', '修炼进度')
  await expect(page.getByText('正文当前：筑基境', { exact: true })).toBeVisible()
  await expect(page.getByLabel('反哺后续写作（默认关闭）')).toBeChecked()
})

test('世界地图把明确距离和方位落实到命名实体，并持久化手动比例尺', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'world-map-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const source = request.messages?.find(message => message.role === 'user')?.content ?? ''
    expect(source).toContain('疆域东西横跨三千公里')
    expect(source).toContain('东港在西京以东，相距六百公里')
    const content = JSON.stringify({
      seed: 'e2e-spatial-map',
      mapName: '空间约束世界',
      pointCount: 3000,
      landRatio: 0.68,
      continentCount: 1,
      stateCount: 2,
      burgDensity: 0.2,
      heightmapTemplate: 'pangea',
      namingStyle: 'chinese',
      stateNames: ['西陆帝国', '东海王国'],
      burgNames: ['西京', '东港'],
      mapWidthKm: 3000,
      mapWidthEvidenceQuote: '疆域东西横跨三千公里',
      spatialEntities: [
        {
          name: '西陆帝国',
          kind: 'state',
          scaleTier: 'empire',
          capitalName: '西京',
          source: 'inferred',
        },
        {
          name: '东海王国',
          kind: 'state',
          scaleTier: 'kingdom',
          capitalName: '东港',
          source: 'inferred',
        },
        {
          name: '西京',
          kind: 'settlement',
          scaleTier: 'metropolis',
          source: 'explicit',
          evidenceQuote: '西京',
        },
        {
          name: '东港',
          kind: 'settlement',
          scaleTier: 'city',
          source: 'explicit',
          evidenceQuote: '东港',
        },
      ],
      spatialRelations: [{
        from: '东港',
        to: '西京',
        direction: 'east',
        distanceTier: 'far',
        distanceValue: 600,
        distanceUnit: 'km',
        source: 'explicit',
        evidenceQuote: '东港在西京以东，相距六百公里',
      }],
    })
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        `data: ${JSON.stringify({
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
        })}`,
        'data: [DONE]',
        '',
      ].join('\n\n'),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 空间约束地图')
  await openSidebarLeaf(page, '世界观', '自然环境')
  await page.getByRole('button', { name: /疆域尺寸/ }).click()
  await page.getByText('世界整体大小、核心区域的疆域范围', { exact: true }).last().click()
  await page.locator('textarea').last().fill('疆域东西横跨三千公里')
  await page.getByRole('heading', { name: '📐 疆域尺寸' }).click()
  await page.getByRole('button', { name: /山川水系/ }).click()
  await page.getByText('重要山脉、河流、湖泊、运河与水路', { exact: true }).last().click()
  await page.locator('textarea').last().fill('东港在西京以东，相距六百公里')
  await page.getByRole('heading', { name: '⛰ 山川水系' }).click()

  await openSidebarLeaf(page, '世界观', '世界地图')
  await page.getByRole('button', { name: 'AI 生成地图', exact: true }).click()
  await expect(page.getByText('比例尺：用户疆域尺寸', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'AI 重新生成', exact: true })).toBeVisible()
  await expect(page.getByText(/2 国/)).toBeVisible()

  const scale = page.locator('select').last()
  await scale.selectOption('2')
  await expect(page.getByText('比例尺：手动设定', { exact: true })).toBeVisible()
  await page.reload()
  await openSidebarLeaf(page, '世界观', '世界地图')
  await expect(page.getByText('比例尺：手动设定', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'AI 重新生成', exact: true })).toBeVisible()
  await expect(page.locator('select').last()).toHaveValue('2')
})

test('角色驱动方案可持久化、复制版本并显式设为后续 AI 参考', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E 角色驱动工作区')

  await openSidebarLeaf(page, '角色设计', '角色生成')
  await page.getByRole('button', { name: /新建角色/ }).click()
  await page.getByRole('button', { name: '主要', exact: true }).click()
  await page.getByRole('button', { name: '守序善良', exact: true }).click()
  await page.getByRole('button', { name: '创建并分流', exact: true }).click()

  await openSidebarLeaf(page, '创作区', '角色驱动')
  await page.getByRole('button', { name: '新建方案', exact: true }).click()
  await expect(page.getByText('角色弧光设定', { exact: true })).toBeVisible()

  const characterPicker = page.locator('select').filter({
    has: page.locator('option', { hasText: '+ 添加角色' }),
  })
  await characterPicker.selectOption({ index: 1 })
  const initial = page.getByPlaceholder('角色在故事开始时的状态、处境、性格特点...')
  const target = page.getByPlaceholder('角色在故事结束时应达到的状态、成长结果...')
  const hint = page.getByPlaceholder(/控制在3卷以内/)
  await initial.fill('逃避故乡与旧案')
  await initial.blur()
  await target.fill('主动承担守护故乡的责任')
  await target.blur()
  await hint.fill('必须服务既有主线')
  await hint.blur()

  await page.getByRole('button', { name: '重命名', exact: true }).click()
  await page.getByPlaceholder('方案名称').fill('归乡弧光')
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByLabel('当前角色驱动方案')).toContainText('归乡弧光')

  await page.getByRole('button', { name: '复制为新版本', exact: true }).click()
  await expect(page.getByLabel('当前角色驱动方案')).toContainText('v2')
  await page.getByRole('button', { name: '设为当前参考', exact: true }).click()
  await expect(page.getByRole('button', { name: '后续 AI 正在参考', exact: true })).toBeVisible()

  await page.reload()
  await openSidebarLeaf(page, '创作区', '角色驱动')
  await expect(page.getByLabel('当前角色驱动方案')).toContainText('v2')
  await expect(page.getByLabel('当前角色驱动方案').locator('option')).toHaveCount(2)
  await expect(initial).toHaveValue('逃避故乡与旧案')
  await expect(target).toHaveValue('主动承担守护故乡的责任')
  await expect(hint).toHaveValue('必须服务既有主线')
  await expect(page.getByRole('button', { name: '后续 AI 正在参考', exact: true })).toBeVisible()
})

test('角色中途重规划保护已写正文，只把审查后的 patch 应用到未来大纲', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'character-revision-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const source = request.messages?.find(message => message.role === 'user')?.content ?? ''
    expect(source).toContain('第 1-1 章')
    expect(source).toContain('已写保护区')
    expect(source).toContain('旧线索浮现')
    expect(source).toContain('终局会师')
    const nodeIds = [...source.matchAll(/\[node:(\d+)\]/g)].map(match => Number(match[1]))
    expect(nodeIds).toHaveLength(3)
    const [writtenNodeId, futureNodeId, endingNodeId] = nodeIds
    const content = JSON.stringify({
      changeSummary: '让新角色在既有正文之后加入归途线。',
      scopeSummary: '第1章保持不动，第2章自然切入，第3章承接终局。',
      affectedWrittenChapters: [{
        ordinal: 1,
        title: '第1章',
        severity: 'medium',
        reason: '正文已成立，只能人工复核，不能自动覆盖。',
        evidenceQuotes: ['旧城门后的承诺已经写入正文'],
        recommendation: 'protect',
      }],
      immutableFacts: [{
        statement: '主角已经推开旧城门。',
        sourceChapterOrdinal: 1,
        evidenceQuote: '主角推开旧城门并立下承诺',
      }],
      conflicts: [],
      foreshadowSuggestions: [{
        chapterOrdinal: 2,
        title: '旧线索浮现',
        suggestion: '让新角色以线索提供者身份出现。',
      }],
      mainPlotSuggestion: '主线目标保持不变，只调整参与角色。',
      options: [
        {
          id: 'light',
          intensity: 'light',
          label: '轻量融入',
          summary: '只补充未来章摘要。',
          risks: [],
          patches: [{
            outlineNodeId: writtenNodeId,
            proposedTitle: '被拒绝的正文改名',
            proposedSummary: '不得写回。',
            reason: '用于验证保护边界。',
          }],
        },
        {
          id: 'balanced',
          intensity: 'balanced',
          label: '中度改线',
          summary: '从第二章开始重排角色切入。',
          risks: ['需要复核终局衔接'],
          patches: [{
            outlineNodeId: futureNodeId,
            proposedTitle: '归途重排',
            proposedSummary: '新角色带来旧案证据，与主角共同踏上归途。',
            reason: '在已写正文之后自然切入。',
          }],
        },
        {
          id: 'deep',
          intensity: 'deep',
          label: '深度重构',
          summary: '连同终局铺垫一起调整。',
          risks: ['调整范围较大'],
          patches: [{
            outlineNodeId: endingNodeId,
            proposedTitle: '终局会师',
            proposedSummary: '多方角色在终局前完成会师。',
            reason: '保留终局锚点标题，只调整摘要。',
          }],
        },
      ],
      warnings: [],
    })
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        `data: ${JSON.stringify({
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 240, completion_tokens: 120, total_tokens: 360 },
        })}`,
        'data: [DONE]',
        '',
      ].join('\n\n'),
    })
  })

  await createBookWithSavedChapter(
    page,
    'E2E 角色中途重规划',
    '主角推开旧城门并立下承诺，旧城门后的承诺已经写入正文。',
  )
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  const secondTitle = page.locator('input[value="第2章"]')
  await expect(secondTitle).toBeVisible()
  await secondTitle.fill('旧线索浮现')
  const renamedSecondTitle = page.locator('input[value="旧线索浮现"]')
  await renamedSecondTitle.blur()
  await renamedSecondTitle.locator('xpath=..').getByPlaceholder('章节摘要（可编辑，失焦自动保存）')
    .fill('主角发现旧案仍有缺口。')
  await renamedSecondTitle.locator('xpath=..').getByPlaceholder('章节摘要（可编辑，失焦自动保存）').blur()

  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  const thirdTitle = page.locator('input[value="第3章"]')
  await expect(thirdTitle).toBeVisible()
  await thirdTitle.fill('终局会师')
  const renamedThirdTitle = page.locator('input[value="终局会师"]')
  await renamedThirdTitle.blur()
  await renamedThirdTitle.locator('xpath=..').getByPlaceholder('章节摘要（可编辑，失焦自动保存）')
    .fill('各方在终局前会师。')
  await renamedThirdTitle.locator('xpath=..').getByPlaceholder('章节摘要（可编辑，失焦自动保存）').blur()

  await openSidebarLeaf(page, '创作区', '角色驱动')
  await page.getByRole('button', { name: '中途重规划', exact: true }).click()
  await expect(page.getByRole('heading', { name: '角色变更影响分析', exact: true })).toBeVisible()
  await expect(page.getByText('已有正文但缺少章节记忆；系统会使用有限证据，结论需重点人工复核。')).toBeVisible()
  await page.getByPlaceholder('写清新旧弧光差异、关键转折和与主线的关系...')
    .fill('新增一名掌握旧案证据的角色，但不得推翻第一章已经成立的承诺。')
  await page.getByRole('button', { name: '分析影响并生成三档方案', exact: true }).click()

  await expect(page.getByRole('heading', { name: '影响分析结果', exact: true })).toBeVisible()
  await expect(page.getByText('已拒绝第 1 章 patch：属于已写保护区', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  await expect(page.getByText('归途重排', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: '应用选中 patch 到未写大纲', exact: true }).click()
  await page.getByRole('button', { name: '应用到大纲', exact: true }).click()
  await expect(page.getByText('已应用 1 项', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await expect(page.locator('input[value="第1章"]')).toBeVisible()
  await expect(page.locator('input[value="归途重排"]')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await expect(page.locator('input[value="第1章"]')).toBeVisible()
  await expect(page.locator('input[value="归途重排"]')).toBeVisible()
})
