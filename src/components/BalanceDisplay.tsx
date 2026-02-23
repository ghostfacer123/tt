import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../contexts/ThemeContext';
import type { Theme } from '../utils/theme';
import { formatCurrency } from '../utils/currencyFormatter';
import type { Currency, Language } from '../types';

interface Props {
  totalOwed: number;
  totalOwe: number;
  currency: Currency;
  language: Language;
  onOwePress?: () => void;
}

export default function BalanceDisplay({ totalOwed, totalOwe, currency, language, onOwePress }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const net = totalOwed - totalOwe;
  const isPositive = net >= 0;
  const styles = createStyles(theme);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('home.balance_summary')}</Text>
      <Text style={[styles.netAmount, { color: isPositive ? theme.colors.success : theme.colors.warning }]}>
        {formatCurrency(Math.abs(net), currency, language)}
      </Text>
      <Text style={[styles.netLabel, { color: isPositive ? theme.colors.success : theme.colors.warning }]}>
        {net === 0
          ? t('friends.all_settled')
          : isPositive
          ? t('home.you_are_owed')
          : t('home.you_owe')}
      </Text>
      <View style={styles.breakdown}>
        <View style={styles.breakdownItem}>
          <Text style={styles.breakdownLabel}>{t('home.you_are_owed')}</Text>
          <Text style={[styles.breakdownAmount, { color: theme.colors.success }]}>
            {formatCurrency(totalOwed, currency, language)}
          </Text>
        </View>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.breakdownItem} onPress={onOwePress} disabled={!onOwePress}>
          <Text style={styles.breakdownLabel}>{t('home.you_owe')}</Text>
          <Text style={[styles.breakdownAmount, { color: theme.colors.warning }]}>
            {formatCurrency(totalOwe, currency, language)}
          </Text>
          {onOwePress && (
            <Text style={[styles.tapHint, { color: theme.colors.textSecondary }]}>
              {t('home.tap_for_breakdown')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    ...theme.shadows.md,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: theme.spacing.xs,
  },
  netAmount: {
    fontSize: 36,
    fontWeight: '800',
    marginBottom: 4,
  },
  netLabel: {
    fontSize: 14,
    marginBottom: theme.spacing.md,
  },
  breakdown: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
  },
  breakdownItem: { flex: 1, alignItems: 'center' },
  breakdownLabel: { fontSize: 11, color: theme.colors.textSecondary, marginBottom: 2 },
  breakdownAmount: { fontSize: 14, fontWeight: '700' },
  tapHint: { fontSize: 10, marginTop: 2 },
  divider: { width: 1, height: 30, backgroundColor: theme.colors.border },
});
