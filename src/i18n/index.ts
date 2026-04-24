import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import ru from './locales/ru.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import pt from './locales/pt.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';

const resources = {
  en: { translation: en },
  ru: { translation: ru },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  zh: { translation: zh },
  ja: { translation: ja },
  pt: { translation: pt },
  ar: { translation: ar },
  hi: { translation: hi },
};

const LANGUAGE_KEY = 'user_language';

const initI18n = async () => {
  let savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);
  
  if (!savedLanguage) {
    // Detect system language
    const locales = Localization.getLocales();
    const systemLanguage = locales[0]?.languageCode;
    
    // Check if we support this language
    if (systemLanguage && resources[systemLanguage as keyof typeof resources]) {
      savedLanguage = systemLanguage;
    } else {
      savedLanguage = 'en';
    }
  }

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: savedLanguage,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
    });
};

initI18n();

export default i18n;
