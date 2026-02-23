import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../services/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../services/supabase';
import { loadMyPendingSettlements } from '../services/groupService';
import type { BalanceItem } from '../services/groupService';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'BalanceBreakdown'>;

export default function BalanceBreakdownScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [items, setItems] = useState<BalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await loadMyPendingSettlements(user.id);
      setItems(data);
    } catch (error) {
      console.error('Error loading balance breakdown:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleMarkAsPaid = async (item: BalanceItem) => {
    Alert.alert(
      t('groups.mark_as_paid'),
      `${t('groups.you_owe')} ${item.totalAmount.toFixed(2)} EGP to ${item.toUserName}?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('groups.mark_as_paid'),
          onPress: async () => {
            try {
              setMarkingPaid(item.settlementId);
              await supabase
                .from('group_settlements')
                .update({ status: 'paid', paid_at: new Date().toISOString() })
                .eq('id', item.settlementId);
              Alert.alert(t('common.success'), t('groups.payment_marked'));
              fetchItems();
            } catch (error) {
              console.error('Error marking as paid:', error);
              Alert.alert(t('common.error'), t('common.error'));
            } finally {
              setMarkingPaid(null);
            }
          },
        },
      ]
    );
  };

  const totalOwe = items.reduce((sum, i) => sum + i.totalAmount, 0);

  const renderItem = ({ item }: { item: BalanceItem }) => (
    <View style={[styles.card, { backgroundColor: theme.colors.card }]}>
      <View style={styles.cardHeader}>
        <Ionicons name="location" size={16} color={theme.colors.primary} />
        <Text style={[styles.groupName, { color: theme.colors.primary }]}>{item.groupName}</Text>
      </View>
      <Text style={[styles.merchantName, { color: theme.colors.text }]}>{item.merchantName}</Text>
      {item.itemNames.length > 0 && (
        <Text style={[styles.itemNames, { color: theme.colors.textSecondary }]}>
          {item.itemNames.join(', ')}
        </Text>
      )}
      <Text style={[styles.dateText, { color: theme.colors.textSecondary }]}>
        {new Date(item.receiptDate).toLocaleDateString()}
      </Text>
      <Text style={[styles.amount, { color: theme.colors.warning }]}>
        {item.totalAmount.toFixed(2)} EGP
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: theme.colors.primary }]}
          onPress={() => handleMarkAsPaid(item)}
          disabled={markingPaid === item.settlementId}
        >
          {markingPaid === item.settlementId ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.actionBtnText}>{t('groups.mark_as_paid')}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtnOutline, { borderColor: theme.colors.border }]}
          onPress={() =>
            navigation.navigate('GroupReceiptSplit', {
              groupId: item.groupId,
              receiptId: item.receiptId,
            })
          }
        >
          <Text style={[styles.actionBtnOutlineText, { color: theme.colors.text }]}>
            {t('groups.view_receipt')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
          {t('groups.you_owe_total')}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={theme.colors.primary} style={styles.loader} />
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(item) => item.settlementId}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="checkmark-circle-outline" size={64} color={theme.colors.success} />
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  {t('friends.all_settled')}
                </Text>
              </View>
            }
          />
          {items.length > 0 && (
            <View style={[styles.footer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
              <Text style={[styles.footerLabel, { color: theme.colors.textSecondary }]}>
                {t('groups.you_owe_total')}
              </Text>
              <Text style={[styles.footerTotal, { color: theme.colors.warning }]}>
                {totalOwe.toFixed(2)} EGP
              </Text>
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  loader: { flex: 1 },
  list: { padding: 16, gap: 12 },
  card: {
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  groupName: { fontSize: 13, fontWeight: '600' },
  merchantName: { fontSize: 17, fontWeight: '700' },
  itemNames: { fontSize: 13 },
  dateText: { fontSize: 12 },
  amount: { fontSize: 20, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  actionBtnOutline: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  actionBtnOutlineText: { fontWeight: '600', fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 16, textAlign: 'center' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderTopWidth: 1,
  },
  footerLabel: { fontSize: 14 },
  footerTotal: { fontSize: 24, fontWeight: '800' },
});
