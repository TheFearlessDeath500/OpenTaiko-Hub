import { register, init, getLocaleFromNavigator } from 'svelte-i18n';

register('en',      () => import('./en.json'));
register('ja',      () => import('./ja.json'));
register('zh-Hans', () => import('./zh-Hans.json'));
register('zh-Hant', () => import('./zh-Hant.json'));

function resolveLocale() {
    const nav = getLocaleFromNavigator() ?? '';

    if (/^zh(-Hans(-|$)|-(CN|SG|MY)(-|$))/i.test(nav) || /^zh$/i.test(nav)) {
        return 'zh-Hans';
    }
    if (/^zh(-Hant(-|$)|-(TW|HK|MO)(-|$))/i.test(nav)) {
        return 'zh-Hant';
    }
    if (/^ja(-|$)/i.test(nav)) return 'ja';

    return 'en';
}

export function setupI18n() {
    init({ fallbackLocale: 'en', initialLocale: resolveLocale() });
}
