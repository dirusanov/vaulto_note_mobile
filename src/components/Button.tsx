import { TouchableOpacity, Text, ActivityIndicator, ViewStyle, StyleProp, TextStyle } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { createStyles } from '../theme/createStyles';

interface ButtonProps {
    title: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'outline' | 'destructive';
    loading?: boolean;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}

export const Button = ({
    title,
    onPress,
    variant = 'primary',
    loading = false,
    disabled = false,
    style,
    textStyle,
}: ButtonProps) => {
    const getBackgroundColor = () => {
        if (disabled) return colors.textMuted;
        if (variant === 'primary') return colors.primary;
        if (variant === 'secondary') return colors.surface;
        if (variant === 'destructive') return 'transparent'; // Outline style
        if (variant === 'outline') return 'transparent';
        return 'transparent';
    };

    const getTextColor = () => {
        if (variant === 'primary') return colors.onPrimary;
        if (variant === 'secondary') return colors.text;
        if (variant === 'destructive') return colors.error;
        return colors.primary;
    };

    const getBorderWidth = () => {
        if (variant === 'outline' || variant === 'destructive') return 1;
        return 0;
    };

    const getBorderColor = () => {
        if (variant === 'destructive') return colors.error;
        return colors.primary;
    };

    return (
        <TouchableOpacity
            style={[
                styles.button,
                {
                    backgroundColor: getBackgroundColor(),
                    borderColor: getBorderColor(),
                    borderWidth: getBorderWidth(),
                },
                style,
            ]}
            onPress={onPress}
            disabled={disabled || loading}
            activeOpacity={0.8}
        >
            {loading ? (
                <ActivityIndicator color={getTextColor()} />
            ) : (
                <Text style={[styles.text, { color: getTextColor() }, textStyle]}>{title}</Text>
            )}
        </TouchableOpacity>
    );
};

const styles = createStyles(() => ({
    // Flat pill: the fill or the outline carries it, no shadow.
    button: {
        minHeight: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.l,
        marginVertical: spacing.s,
    },
    text: {
        fontSize: 16,
        fontWeight: '600',
    },
}));
