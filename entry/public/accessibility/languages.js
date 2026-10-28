// The eleven written languages Mgadi's interface is built to carry, in one place. The code is the BCP 47 tag used for `lang`
// attributes, so a screen reader knows which language it is reading. South African Sign Language (SASL) is NOT in this list: it is a
// separate language with its own pathway (public/accessibility/signs.js), not a translation of text.
//
// Being listed here is not a claim that a translation exists. What exists is counted from the catalog (translationState in catalog.js)
// and tracked, with reviewer status, in translations/REVIEW-STATUS.json. A language with no translation shows English and says so.
export const LANGUAGE_LIST = Object.freeze([
  { code: 'en', name: 'English' },
  { code: 'zu', name: 'isiZulu' },
  { code: 'xh', name: 'isiXhosa' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'st', name: 'Sesotho' },
  { code: 'tn', name: 'Setswana' },
  { code: 'nso', name: 'Sepedi (Sesotho sa Leboa)' },
  { code: 'ss', name: 'siSwati' },
  { code: 'nr', name: 'isiNdebele' },
  { code: 'ts', name: 'Xitsonga' },
  { code: 've', name: 'Tshivenda' },
]);

export const languages = Object.freeze(Object.fromEntries(LANGUAGE_LIST.map((entry) => [entry.code, entry.name])));
export const languageCodes = Object.freeze(LANGUAGE_LIST.map((entry) => entry.code));
