// Follow the visible incident -> mode choice. Later clarification choices need no second mode selection.
export async function chooseSituation(page, text) {
  const landing = await page.locator('.landing-choices').count();
  await page.locator('.incident-choices button').filter({ hasText: text }).click();
  if (landing) await page.getByRole('button', { name: 'Tell Mgadi by text', exact: true }).click();
}
