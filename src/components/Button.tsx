import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, StyleProp } from 'react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface ButtonProps {
    title: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'outline' | 'destructive';
    loading?: boolean;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}

export const Button = ({
    title,
    onPress,
    variant = 'primary',
    loading = false,
    disabled = false,
    style,
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
        if (variant === 'primary') return colors.surface;
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
                    // Remove shadow/elevation for transparent buttons to avoid gray frame
                    elevation: (variant === 'destructive' || variant === 'outline') ? 0 : 2,
                    shadowOpacity: (variant === 'destructive' || variant === 'outline') ? 0 : 0.05,
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
                <Text style={[styles.text, { color: getTextColor() }]}>{title}</Text>
            )}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    button: {
        height: 50,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.l,
        marginVertical: spacing.s,
        // Shadow for depth
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.05,
        shadowRadius: 3.84,
        elevation: 2,
    },
    text: {
        ...typography.button,
    },
});
