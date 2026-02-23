import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import type { GroupReceipt } from '../services/groupService';

interface ReceiptCardProps {
  receipt: GroupReceipt;
  onPress: () => void;
}

export const ReceiptCard: React.FC<ReceiptCardProps> = ({ receipt, onPress }) => {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const statusColor =
    receipt.status === 'settled' || receipt.status === 'archived'
      ? '#22c55e'
      : receipt.status === 'pending'
      ? theme.colors.primary
      : '#f59e0b';

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: theme.colors.card }]}
      onPress={onPress}
    >
      <View style={[styles.iconContainer, { backgroundColor: statusColor + '20' }]}>
        <Ionicons name="receipt-outline" size={28} color={statusColor} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.merchant, { color: theme.colors.text }]}>
          {receipt.merchant_name}
        </Text>
        <Text style={[styles.total, { color: theme.colors.primary }]}>
          {receipt.total_amount.toFixed(2)} EGP
        </Text>
        <View style={styles.row}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {receipt.status.charAt(0).toUpperCase() + receipt.status.slice(1)}
            </Text>
          </View>
          <Text style={[styles.itemCount, { color: theme.colors.textSecondary }]}>
            {t('groups.items_count', { count: receipt.items.length })}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    marginVertical: 4,
    marginHorizontal: 12,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: { flex: 1 },
  merchant: { fontSize: 16, fontWeight: '600' },
  total: { fontSize: 18, fontWeight: 'bold', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusText: { fontSize: 12, fontWeight: '600' },
  itemCount: { fontSize: 12 },
});
