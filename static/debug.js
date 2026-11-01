/* Explicit, local-only diagnostic TXT viewer in Settings. */
(() => {
  const open = document.querySelector('#debugOpenBtn');
  const modal = document.querySelector('#debugModal');
  if (!open || !modal) return;
  const close = document.querySelector('#debugCloseBtn');
  const output = document.querySelector('#debugText');
  const status = document.querySelector('#debugStatus');
  const copy = document.querySelector('#debugCopyBtn');
  let requestId = 0;
  function dismiss() {
    requestId++;
    modal.classList.add('hidden');
    open.focus();
  }
  open.addEventListener('click', async () => {
    const id = ++requestId;
    modal.classList.remove('hidden');
    output.value = '';
    status.textContent = 'Vytvářím místní diagnostický výpis…';
    copy.disabled = true;
    close.focus();
    try {
      const month = document.querySelector('#dashboardMonthPicker')?.value ||
        new Date().toISOString().slice(0,7);
      const result = await api('/api/debug/report', {
        method: 'POST', body: JSON.stringify({month})
      });
      if (requestId !== id) return;
      output.value = String(result.text || '');
      copy.disabled = !output.value;
      status.textContent = 'Výpis připraven · ' +
        new Intl.NumberFormat('cs-CZ').format(output.value.length) + ' znaků.';
    } catch (error) {
      if (requestId !== id) return;
      status.textContent = 'Nepodařilo se vytvořit debug: ' + error.message;
    }
  });
  close.addEventListener('click', dismiss);
  modal.addEventListener('click', event => {
    if (event.target === modal) dismiss();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) dismiss();
  });
  copy.addEventListener('click', async () => {
    if (!output.value) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(output.value);
      } else {
        output.focus();
        output.select();
        if (!document.execCommand('copy')) throw new Error('Schránka není dostupná.');
      }
      status.textContent = 'TXT výpis byl zkopírován do schránky.';
    } catch (error) {
      status.textContent = 'Kopírování selhalo: ' + error.message +
        '. Obsah lze označit a zkopírovat ručně (Ctrl+A, Ctrl+C).';
    }
  });
})();
