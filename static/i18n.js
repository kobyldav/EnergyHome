(() => {
  'use strict';

  const STORAGE_KEY = 'energy_app_language';
  const SUPPORTED = new Set(['cs', 'en']);

  const CS_TO_EN = {
    'Přehled energie': 'Home Energy',
    'analýza spotřeby': 'local analytics',
    'Přehled': 'Overview',
    'Dashboard': 'Dashboard',
    'Měření a spotřeba': 'Measurement & Consumption',
    'Měřidla a odečty': 'Meters & Readings',
    'Spotřebiče': 'Appliances',
    'Topení a radiátory': 'Heating & Radiators',
    'Finance': 'Finance',
    'Ceníky': 'Tariffs',
    'Zálohy': 'Advance Payments',
    'Systém': 'System',
    'Nastavení': 'Settings',
    'Pouze lokální data': 'Local data only',
    'ENERGETICKÝ ERP': 'ENERGY ERP',
    'Připraveno': 'Ready',
    'Obnovit': 'Refresh',
    'Elektřina': 'Electricity',
    'poslední období': 'latest period',
    'Studená voda': 'Cold Water',
    'Teplá voda': 'Hot Water',
    'Plyn': 'Gas',
    'Teplo': 'Heat',
    'součet radiátorů · poslední období': 'radiator total · latest period',
    'Náklady': 'Costs',
    'bez dat': 'no data',
    'ZÚČTOVÁNÍ': 'BILLING',
    'Finanční pozice': 'Financial Position',
    'Aktuálně': 'Current',
    'Predikce konce období': 'End-of-period Forecast',
    'Nedoplatek': 'Amount Due',
    'Přeplatek': 'Credit',
    'Zaplacené zálohy': 'Advance Payments Paid',
    'Skutečné náklady': 'Actual Costs',
    'DETEKTIV': 'DETECTOR',
    'Upozornění': 'Alerts',
    'TOPENÍ': 'HEATING',
    'Spotřeba radiátorů podle místností': 'Radiator Consumption by Room',
    'Spravovat topné měřiče': 'Manage Heat Allocators',
    'NÁKLADY': 'COSTS',
    'Fixní vs. proměnlivé': 'Fixed vs. Variable',
    'ELEKTŘINA': 'ELECTRICITY',
    'Vrstvená spotřeba': 'Stacked Consumption',
    'Vodopádový přehled': 'Waterfall Overview',
    'MĚŘIDLA': 'METERS',
    'Přidat měřidlo': 'Add Meter',
    'Název': 'Name',
    'Typ': 'Type',
    'Počáteční stav': 'Initial Reading',
    'Stav platí k datu': 'Reading Effective Date',
    'Uložit měřidlo': 'Save Meter',
    'Počáteční stav je skutečná hodnota na měřidle při zavedení do aplikace. Nemusí být 0.': 'The initial reading is the actual meter value when the meter is added to the app. It does not have to be 0.',
    'ODEČET': 'READING',
    'Zadat jeden odečet': 'Enter a Reading',
    'jednotlivě': 'individual',
    'Měřidlo': 'Meter',
    'Datum odečtu': 'Reading Date',
    'Stav měřidla': 'Meter Reading',
    'Uložit odečet': 'Save Reading',
    'Každé měřidlo má vlastní historii.': 'Each meter has its own history.',
    'SEZNAM': 'LIST',
    'Měřidla': 'Meters',
    'HISTORIE': 'HISTORY',
    'Jednotlivé odečty': 'Individual Readings',
    'Datum': 'Date',
    'Stav': 'Reading',
    'PROFILY': 'PROFILES',
    'Přidat spotřebič': 'Add Appliance',
    'Aktivní / cyklický': 'Active / Cyclic',
    'Pasivní / trvalý': 'Passive / Continuous',
    'kWh / cyklus': 'kWh / cycle',
    'l studené vody / cyklus': 'L cold water / cycle',
    'l teplé vody / cyklus': 'L hot water / cycle',
    'm³ plynu / cyklus': 'm³ gas / cycle',
    'kWh / den': 'kWh / day',
    'l studené vody / den': 'L cold water / day',
    'l teplé vody / den': 'L hot water / day',
    'm³ plynu / den': 'm³ gas / day',
    'Uložit profil': 'Save Profile',
    'MĚSÍČNÍ VSTUP': 'MONTHLY INPUT',
    'Počet cyklů aktivních spotřebičů': 'Active Appliance Cycle Counts',
    'Měsíc': 'Month',
    'Uložit počty cyklů': 'Save Cycle Counts',
    'RADIÁTOR': 'RADIATOR',
    'Přidat topný měřič': 'Add Heat Allocator',
    'Místnost': 'Room',
    'Název měřiče': 'Meter Name',
    'Číslo měřiče': 'Meter Number',
    '(volitelné)': '(optional)',
    'Jednotka odečtu': 'Reading Unit',
    'Počáteční stav platí k': 'Initial Reading Date',
    'Přepočtový koeficient': 'Conversion Factor',
    '(pokud ho znáte)': '(if known)',
    'Uložit topný měřič': 'Save Heat Allocator',
    'Jde o odečtové zařízení připevněné na radiátoru. Koeficient ponechte 1, pokud neznáte oficiální přepočet pro konkrétní radiátor.': 'This is a reading device attached to a radiator. Leave the factor at 1 if you do not know the official conversion for the specific radiator.',
    'ODEČET TOPENÍ': 'HEATING READING',
    'Zadat stav radiátoru': 'Enter Radiator Reading',
    'Topný měřič': 'Heat Allocator',
    'Stav na displeji': 'Display Reading',
    'Měřič byl před tímto odečtem vynulován / vyměněn': 'The meter was reset / replaced before this reading',
    'Uložit odečet topení': 'Save Heating Reading',
    'Spotřeba se počítá jako konstatní poměr např. v osobním domě. Ale v panelovém domě se cena rozchází o poměr rozlohy...': 'Utility consumption is calculated as a fixed ratio, for example, in a single-family home. But in a prefabricated apartment building, the cost varies in proportion to the floor area...',
    'MÍSTNOSTI': 'ROOMS',
    'Začněte přidáním měřidla. Nastavte jeho skutečný počáteční stav a potom zadávejte jednotlivé odečty.': 'Start by adding a meter. Set its actual initial reading, and then enter each reading.',
    'Souhrn vytápění': 'Heating Summary',
    'Počet radiátorů': 'Radiator Count',
    'Poslední přírůstek': 'Latest Increase',
    'Celkem od založení': 'Total Since Setup',
    'Topné měřiče': 'Heat Allocators',
    'Odečty topení': 'Heating Readings',
    'Místnost / měřič': 'Room / Meter',
    'Rozdíl': 'Difference',
    'Provizorní definice tepla.': 'Provisional heat definition.',
    'Celková spotřeba tepla se nyní počítá jako součet přepočtených přírůstků všech radiátorových měřičů. Tato hodnota se používá jako „Teplo“ v dashboardu i ve finančním výpočtu. Jednotka zatím není ověřená GJ a později ji lze nahradit přesným převodem.': 'Total heat consumption is currently calculated as the sum of converted increases from all radiator heat allocators. This value is used as “Heat” on the dashboard and in financial calculations. The unit is not yet verified as GJ and can later be replaced with an exact conversion.',
    'HISTORIE CEN': 'PRICE HISTORY',
    'Nová verze ceníku': 'New Tariff Version',
    'Platí od': 'Effective From',
    'Elektřina [Kč/kWh]': 'Electricity [CZK/kWh]',
    'Studená voda [Kč/m³]': 'Cold Water [CZK/m³]',
    'Teplá voda [Kč/m³]': 'Hot Water [CZK/m³]',
    'Plyn [Kč/m³]': 'Gas [CZK/m³]',
    'Teplo [Kč / provizorní jednotku]': 'Heat [CZK / provisional unit]',
    'Fixní poplatky za měsíc': 'Monthly Fixed Fees',
    'Každé médium má vlastní fixní část.': 'Each utility has its own fixed component.',
    'Elektřina – fix [Kč/měsíc]': 'Electricity – fixed [CZK/month]',
    'Studená voda – fix [Kč/měsíc]': 'Cold Water – fixed [CZK/month]',
    'Teplá voda – fix [Kč/měsíc]': 'Hot Water – fixed [CZK/month]',
    'Plyn – fix [Kč/měsíc]': 'Gas – fixed [CZK/month]',
    'Teplo – fix [Kč/měsíc]': 'Heat – fixed [CZK/month]',
    'Uložit ceník od tohoto data': 'Save Tariff From This Date',
    'Ceníky se nepřepisují zpětně.': 'Tariffs are not changed retroactively.',
    'Nový ceník platí od zadaného data. Starší měsíce zůstávají počítané podle staršího ceníku.': 'The new version applies from the selected date. Earlier months remain calculated using the previous tariff.',
    'CENÍKY': 'TARIFFS',
    'Historie platnosti': 'Effective-date History',
    'ENERGIE': 'ENERGY',
    'Měsíční zálohy': 'Monthly Advance Payments',
    'Elektřina [Kč/měsíc]': 'Electricity [CZK/month]',
    'Studená voda [Kč/měsíc]': 'Cold Water [CZK/month]',
    'Teplá voda [Kč/měsíc]': 'Hot Water [CZK/month]',
    'Plyn [Kč/měsíc]': 'Gas [CZK/month]',
    'Teplo [Kč/měsíc]': 'Heat [CZK/month]',
    'Uložit zálohy od tohoto data': 'Save Advance Payments From This Date',
    'Tady se zadávají pouze zálohy: elektřina, studená voda, teplá voda, plyn a teplo. Každá změna platí od zadaného data dál.': 'Only advance payments are entered here: electricity, cold water, hot water, gas and heat. Each change applies from the selected date onward.',
    'Změny záloh': 'Advance Payment Changes',
    'SYSTÉM': 'SYSTEM',
    'Nastavení domácnosti': 'Household Settings',
    'Název domácnosti': 'Household Name',
    'Začátek zúčtovacího období': 'Billing Period Start',
    'Měna': 'Currency',
    'Citlivost detektiva [%]': 'Detector Sensitivity [%]',
    'Uložit nastavení': 'Save Settings',
    'Data zůstávají v počítači.': 'Data stays on this computer.',
    'Soubor je uložen v': 'The file is stored in',
    '. Při každém uložení vzniká také záložní kopie.': '. A backup copy is also created every time data is saved.',
    'Více než 70 % spotřeby studená voda zatím není přiřazeno ke známým spotřebičům.': 'More than 70% of cold water consumption has not yet been attributed to known appliances.',
    'Více než 70 % spotřeby teplá voda zatím není přiřazeno ke známým spotřebičům.': 'More than 70% of hot water consumption has not yet been attributed to known appliances.',
    'Teplo je nyní provizorně počítáno jako součet všech radiátorových měřičů. Výsledná jednotka není ověřená GJ; později lze přidat přesný převod.': 'Heat is currently calculated provisionally as the sum of all radiator meters. The resulting unit is not verified in GJ; an accurate conversion can be added later.',

    // Common dynamic UI strings. app.js can also call window.t(...) directly.
    'Uloženo': 'Saved',
    'Ukládám…': 'Saving…',
    'Načítám…': 'Loading…',
    'Chyba': 'Error',
    'Smazat': 'Delete',
    'Upravit': 'Edit',
    'Zrušit': 'Cancel',
    'Žádná data': 'No data',
    'Žádné záznamy': 'No records',
    'Celkem': 'Total',
    'Spotřeba': 'Consumption',
    'Cena': 'Price',
    'Fixní': 'Fixed',
    'Proměnlivé': 'Variable',
    'Ano': 'Yes',
    'Ne': 'No'
  };

  const ATTRIBUTE_TRANSLATIONS = {
    'Hlavní elektroměr': 'Main electricity meter',
    'Pračka': 'Washing machine',
    'Obývací pokoj': 'Living room',
    'Radiátor u okna': 'Radiator by the window',
    'např. 0185421': 'e.g. 0185421',
    'jednotek': 'units'
  };

  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  let currentLanguage = getStoredLanguage();

  function getStoredLanguage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.has(stored) ? stored : 'cs';
  }

  function translateValue(value, dictionary = CS_TO_EN) {
    if (currentLanguage === 'cs' || typeof value !== 'string') return value;

    const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match) return value;

    const [, before, core, after] = match;
    const translated = dictionary[core];
    return translated ? `${before}${translated}${after}` : value;
  }

  function translateTextNode(node) {
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const original = originalText.get(node);
    const next = currentLanguage === 'en' ? translateValue(original) : original;
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function translateAttribute(element, attribute) {
    if (!element.hasAttribute(attribute)) return;

    let store = originalAttributes.get(element);
    if (!store) {
      store = {};
      originalAttributes.set(element, store);
    }
    if (!(attribute in store)) store[attribute] = element.getAttribute(attribute);

    const original = store[attribute];
    const dictionary = attribute === 'placeholder' ? ATTRIBUTE_TRANSLATIONS : CS_TO_EN;
    const next = currentLanguage === 'en' ? translateValue(original, dictionary) : original;
    if (element.getAttribute(attribute) !== next) element.setAttribute(attribute, next);
  }

  function translateElement(element) {
    if (!(element instanceof Element)) return;

    for (const attr of ['placeholder']) translateAttribute(element, attr);

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest('script, style')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
  }

  const FLAG_SVG = {
    cs: {
      viewBox: '0 0 30 20',
      markup: `
        <rect width="30" height="10" fill="#fff"/>
        <rect y="10" width="30" height="10" fill="#d7141a"/>
        <path d="M0 0L13 10L0 20Z" fill="#11457e"/>
      `
    },
    en: {
      viewBox: '0 0 60 40',
      markup: `
        <rect width="60" height="40" fill="#012169"/>
        <path d="M0 0L60 40M60 0L0 40" stroke="#fff" stroke-width="8"/>
        <path d="M0 0L60 40M60 0L0 40" stroke="#c8102e" stroke-width="4"/>
        <path d="M30 0V40M0 20H60" stroke="#fff" stroke-width="12"/>
        <path d="M30 0V40M0 20H60" stroke="#c8102e" stroke-width="7"/>
      `
    }
  };

  function updateLanguageButton() {
    const button = document.getElementById('languageSwitch');
    const flag = document.getElementById('languageFlag');
    if (!button || !flag) return;

    const nextFlag = FLAG_SVG[currentLanguage];
    flag.setAttribute('viewBox', nextFlag.viewBox);
    flag.innerHTML = nextFlag.markup;
    flag.dataset.language = currentLanguage;

    if (currentLanguage === 'cs') {
      button.setAttribute('aria-label', 'Přepnout do angličtiny');
      button.title = 'English';
    } else {
      button.setAttribute('aria-label', 'Switch to Czech');
      button.title = 'Čeština';
    }
  }

  function applyLanguage(language) {
    if (!SUPPORTED.has(language)) return;

    currentLanguage = language;
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.title = language === 'en' ? 'Home Energy' : 'Domácí energie';

    translateElement(document.body);
    updateLanguageButton();

    document.dispatchEvent(new CustomEvent('app-language-change', {
      detail: { language }
    }));
  }

  function toggleLanguage() {
    applyLanguage(currentLanguage === 'cs' ? 'en' : 'cs');
  }

  const button = document.getElementById('languageSwitch');
  if (button) button.addEventListener('click', toggleLanguage);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          translateTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          translateElement(node);
        }
      }

      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        // If app.js rewrites an existing text node, regard the new Czech value as its new source.
        const value = mutation.target.nodeValue;
        if (currentLanguage === 'cs' || CS_TO_EN[value?.trim()]) {
          originalText.set(mutation.target, value);
          translateTextNode(mutation.target);
        }
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });

  // Public helpers for static/app.js once its dynamic strings are migrated.
  window.t = function t(czechText) {
    return currentLanguage === 'en' ? (CS_TO_EN[czechText] || czechText) : czechText;
  };
  window.setAppLanguage = applyLanguage;
  window.getAppLanguage = () => currentLanguage;

  applyLanguage(currentLanguage);
})();
