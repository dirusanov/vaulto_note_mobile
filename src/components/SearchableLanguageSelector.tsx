import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, SafeAreaView, StatusBar, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { TextInput } from './TextInput';
import { TranscriptionLanguage } from '../utils/storage';
import { createStyles } from '../theme/createStyles';

export interface LanguageOption {
    key: string;
    label: string;
}

export const WHISPER_LANGUAGES: LanguageOption[] = [
    { key: 'auto', label: 'Auto-Detect' },
    { key: 'en', label: 'English' },
    { key: 'zh', label: 'Chinese' },
    { key: 'de', label: 'German' },
    { key: 'es', label: 'Spanish' },
    { key: 'ru', label: 'Russian' },
    { key: 'ko', label: 'Korean' },
    { key: 'fr', label: 'French' },
    { key: 'ja', label: 'Japanese' },
    { key: 'pt', label: 'Portuguese' },
    { key: 'tr', label: 'Turkish' },
    { key: 'pl', label: 'Polish' },
    { key: 'ca', label: 'Catalan' },
    { key: 'nl', label: 'Dutch' },
    { key: 'ar', label: 'Arabic' },
    { key: 'sv', label: 'Swedish' },
    { key: 'it', label: 'Italian' },
    { key: 'id', label: 'Indonesian' },
    { key: 'hi', label: 'Hindi' },
    { key: 'fi', label: 'Finnish' },
    { key: 'vi', label: 'Vietnamese' },
    { key: 'he', label: 'Hebrew' },
    { key: 'uk', label: 'Ukrainian' },
    { key: 'el', label: 'Greek' },
    { key: 'ms', label: 'Malay' },
    { key: 'cs', label: 'Czech' },
    { key: 'ro', label: 'Romanian' },
    { key: 'da', label: 'Danish' },
    { key: 'hu', label: 'Hungarian' },
    { key: 'ta', label: 'Tamil' },
    { key: 'no', label: 'Norwegian' },
    { key: 'th', label: 'Thai' },
    { key: 'ur', label: 'Urdu' },
    { key: 'hr', label: 'Croatian' },
    { key: 'bg', label: 'Bulgarian' },
    { key: 'lt', label: 'Lithuanian' },
    { key: 'la', label: 'Latin' },
    { key: 'mi', label: 'Maori' },
    { key: 'ml', label: 'Malayalam' },
    { key: 'cy', label: 'Welsh' },
    { key: 'sk', label: 'Slovak' },
    { key: 'te', label: 'Telugu' },
    { key: 'fa', label: 'Persian' },
    { key: 'lv', label: 'Latvian' },
    { key: 'bn', label: 'Bengali' },
    { key: 'sr', label: 'Serbian' },
    { key: 'az', label: 'Azerbaijani' },
    { key: 'sl', label: 'Slovenian' },
    { key: 'kn', label: 'Kannada' },
    { key: 'et', label: 'Estonian' },
    { key: 'mk', label: 'Macedonian' },
    { key: 'br', label: 'Breton' },
    { key: 'eu', label: 'Basque' },
    { key: 'is', label: 'Icelandic' },
    { key: 'hy', label: 'Armenian' },
    { key: 'ne', label: 'Nepali' },
    { key: 'mn', label: 'Mongolian' },
    { key: 'bs', label: 'Bosnian' },
    { key: 'kk', label: 'Kazakh' },
    { key: 'sq', label: 'Albanian' },
    { key: 'sw', label: 'Swahili' },
    { key: 'gl', label: 'Galician' },
    { key: 'mr', label: 'Marathi' },
    { key: 'pa', label: 'Punjabi' },
    { key: 'si', label: 'Sinhala' },
    { key: 'km', label: 'Khmer' },
    { key: 'sn', label: 'Shona' },
    { key: 'yo', label: 'Yoruba' },
    { key: 'so', label: 'Somali' },
    { key: 'af', label: 'Afrikaans' },
    { key: 'oc', label: 'Occitan' },
    { key: 'ka', label: 'Georgian' },
    { key: 'be', label: 'Belarusian' },
    { key: 'tg', label: 'Tajik' },
    { key: 'sd', label: 'Sindhi' },
    { key: 'gu', label: 'Gujarati' },
    { key: 'am', label: 'Amharic' },
    { key: 'yi', label: 'Yiddish' },
    { key: 'lo', label: 'Lao' },
    { key: 'uz', label: 'Uzbek' },
    { key: 'fo', label: 'Faroese' },
    { key: 'ht', label: 'Haitian Creole' },
    { key: 'ps', label: 'Pashto' },
    { key: 'tk', label: 'Turkmen' },
    { key: 'nn', label: 'Nynorsk' },
    { key: 'mt', label: 'Maltese' },
    { key: 'sa', label: 'Sanskrit' },
    { key: 'lb', label: 'Luxembourgish' },
    { key: 'my', label: 'Myanmar' },
    { key: 'bo', label: 'Tibetan' },
    { key: 'tl', label: 'Tagalog' },
    { key: 'mg', label: 'Malagasy' },
    { key: 'as', label: 'Assamese' },
    { key: 'tt', label: 'Tatar' },
    { key: 'haw', label: 'Hawaiian' },
    { key: 'ln', label: 'Lingala' },
    { key: 'ha', label: 'Hausa' },
    { key: 'ba', label: 'Bashkir' },
    { key: 'jw', label: 'Javanese' },
    { key: 'su', label: 'Sundanese' },
];


interface SearchableLanguageSelectorProps {
    value: TranscriptionLanguage;
    onChange: (value: TranscriptionLanguage) => void;
}

export const SearchableLanguageSelector: React.FC<SearchableLanguageSelectorProps> = ({ value, onChange }) => {
    const { t } = useTranslation();

    const [modalVisible, setModalVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Language names stay as-is; only the "auto" entry is app UI copy.
    const getLanguageLabel = (lang: LanguageOption) =>
        lang.key === 'auto' ? t('aux.autoDetect', 'Auto-Detect') : lang.label;

    const selectedLanguageLabel = useMemo(() => {
        const selected = WHISPER_LANGUAGES.find(l => l.key === value);
        return selected ? getLanguageLabel(selected) : t('aux.autoDetect', 'Auto-Detect');
    }, [value, t]);

    const filteredLanguages = useMemo(() => {
        if (!searchQuery) return WHISPER_LANGUAGES;
        const lowerQuery = searchQuery.toLowerCase();
        return WHISPER_LANGUAGES.filter(
            lang => lang.label.toLowerCase().includes(lowerQuery)
                || getLanguageLabel(lang).toLowerCase().includes(lowerQuery)
                || lang.key.toLowerCase().includes(lowerQuery)
        );
    }, [searchQuery, t]);

    const handleSelect = (key: string) => {
        onChange(key as TranscriptionLanguage);
        setModalVisible(false);
        setSearchQuery('');
    };

    return (
        <View>
            <TouchableOpacity 
                style={styles.selectorButton}
                activeOpacity={0.8}
                onPress={() => setModalVisible(true)}
            >
                <Text style={styles.selectorText}>{selectedLanguageLabel}</Text>
                <MaterialIcons name="arrow-drop-down" size={16} color={colors.primary} />
            </TouchableOpacity>

            <Modal
                visible={modalVisible}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setModalVisible(false)}
            >
                <SafeAreaView style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={() => setModalVisible(false)}
                            accessibilityRole="button"
                            accessibilityLabel={t('a11y.close', 'Close')}
                        >
                            <MaterialIcons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={styles.modalTitle}>{t("aux.selectLanguage", "Select Language")}</Text>
                        <View style={{ width: 44 }} />
                    </View>

                    <View style={styles.searchContainer}>
                        <MaterialIcons name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder={t('aux.searchLanguage', 'Search language...')}
                            placeholderTextColor={colors.textSecondary}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoFocus={false}
                            clearButtonMode="while-editing"
                        />
                    </View>

                    <FlatList
                        data={filteredLanguages}
                        keyExtractor={(item) => item.key}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => {
                            const isSelected = item.key === value;
                            return (
                                <TouchableOpacity
                                    style={[styles.languageItem, isSelected && styles.languageItemActive]}
                                    onPress={() => handleSelect(item.key)}
                                >
                                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                         <Text style={[styles.languageText, isSelected && styles.languageTextActive]}>
                                             {getLanguageLabel(item)}
                                         </Text>
                                    </View>
                                    {isSelected && <MaterialIcons name="check" size={20} color={colors.primary} />}
                                </TouchableOpacity>
                            );
                        }}
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <Text style={styles.emptyText}>{t('aux.noLanguagesFound', 'No languages found for "{{query}}"', { query: searchQuery })}</Text>
                            </View>
                        }
                    />
                </SafeAreaView>
            </Modal>
        </View>
    );
};

const styles = createStyles(() => ({
    selectorButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingVertical: 4,
        paddingHorizontal: spacing.s,
        backgroundColor: colors.primary + '15',
        borderRadius: 8,
        gap: 2,
    },
    selectorText: {
        ...typography.body,
        fontSize: 13,
        color: colors.primary,
        fontWeight: '600',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: colors.background,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.m,
        paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + spacing.s : spacing.s,
        paddingBottom: spacing.s,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
    },
    modalTitle: {
        ...typography.h3,
        color: colors.text,
    },
    closeButton: {
        padding: spacing.xs,
        marginLeft: -spacing.xs,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.backgroundSecondary,
        margin: spacing.m,
        paddingHorizontal: spacing.s,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
    },
    searchIcon: {
        marginRight: spacing.xs,
    },
    searchInput: {
        flex: 1,
        borderWidth: 0,
        backgroundColor: 'transparent',
        paddingVertical: 12,
        ...typography.body,
        color: colors.text,
    },
    listContent: {
        paddingHorizontal: spacing.m,
        paddingBottom: spacing.xxl,
    },
    languageItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: spacing.m,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
    },
    languageItemActive: {
        // backgroundColor: colors.primary + '10', // Optional subtle highlight
    },
    languageText: {
        ...typography.body,
        color: colors.text,
    },
    languageTextActive: {
        color: colors.primary,
        fontWeight: 'bold',
    },
    emptyContainer: {
        padding: spacing.xl,
        alignItems: 'center',
    },
    emptyText: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
    },
}));
