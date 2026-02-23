import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../services/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../services/supabase';
import {
  loadGroupMembers,
  addGroupMember,
  removeGroupMember,
  deleteGroup,
  loadArchivedReceipts,
} from '../services/groupService';
import type { GroupMember, GroupReceipt } from '../services/groupService';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupSettings'>;

export default function GroupSettingsScreen({ navigation, route }: Props) {
  const { groupId, groupName } = route.params;
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [archivedReceipts, setArchivedReceipts] = useState<GroupReceipt[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [memberData, groupData] = await Promise.all([
        loadGroupMembers(groupId),
        supabase.from('groups').select('created_by').eq('id', groupId).single(),
      ]);
      setMembers(memberData);
      setCreatorId(groupData.data?.created_by ?? null);
    } catch (error) {
      console.error('Error loading group settings:', error);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const fetchArchivedReceipts = useCallback(async () => {
    try {
      const data = await loadArchivedReceipts(groupId);
      setArchivedReceipts(data);
    } catch (error) {
      console.error('Error loading archived receipts:', error);
    }
  }, [groupId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isCreator = user?.id === creatorId;

  const handleAddMember = async () => {
    if (!addEmail.trim()) return;
    setAdding(true);
    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .or(`email.eq.${addEmail.trim()},phone.eq.${addEmail.trim()}`);

      if (!profiles || profiles.length === 0) {
        Alert.alert(t('common.error'), t('groups.member_not_found'));
        return;
      }

      const profile = profiles[0];
      const alreadyMember = members.some((m) => m.user_id === profile.id);
      if (alreadyMember) {
        Alert.alert(t('common.error'), t('groups.already_member'));
        return;
      }

      await addGroupMember(groupId, profile.id);
      Alert.alert(t('common.success'), t('groups.member_added'));
      setAddEmail('');
      setShowAddModal(false);
      fetchData();
    } catch (error) {
      console.error('Error adding member:', error);
      Alert.alert(t('common.error'), t('common.error'));
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = (member: GroupMember) => {
    if (!isCreator) return;
    if (member.user_id === user?.id) {
      Alert.alert(t('common.error'), t('groups.cannot_remove_creator'));
      return;
    }
    Alert.alert(t('groups.remove_member'), t('groups.remove_member_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeGroupMember(groupId, member.user_id);
            fetchData();
          } catch (error) {
            Alert.alert(t('common.error'), t('common.error'));
          }
        },
      },
    ]);
  };

  const handleLeaveGroup = () => {
    if (!user) return;
    Alert.alert(t('groups.leave_group'), t('groups.leave_group_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.leave_group'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeGroupMember(groupId, user.id);
            navigation.popToTop();
          } catch (error) {
            Alert.alert(t('common.error'), t('common.error'));
          }
        },
      },
    ]);
  };

  const handleDeleteGroup = () => {
    if (!isCreator) return;
    Alert.alert(t('groups.delete_group'), t('groups.delete_group_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteGroup(groupId);
            navigation.popToTop();
          } catch (error) {
            Alert.alert(t('common.error'), t('common.error'));
          }
        },
      },
    ]);
  };

  const renderMember = ({ item }: { item: GroupMember }) => (
    <View style={[styles.memberRow, { backgroundColor: theme.colors.card }]}>
      <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
        <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, { color: theme.colors.text }]}>
          {item.name}
          {item.user_id === user?.id ? ` (${t('split.you')})` : ''}
        </Text>
        {item.user_id === creatorId && (
          <Text style={[styles.creatorLabel, { color: theme.colors.primary }]}>
            {t('groups.creator')}
          </Text>
        )}
      </View>
      {isCreator && item.user_id !== user?.id && (
        <TouchableOpacity onPress={() => handleRemoveMember(item)} style={styles.removeBtn}>
          <Ionicons name="remove-circle" size={22} color={(theme.colors as any).error ?? '#ef4444'} />
        </TouchableOpacity>
      )}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={styles.loader} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
          {t('groups.group_settings')}
        </Text>
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={renderMember}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
            {t('groups.members')}
          </Text>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {/* Add member button */}
            <TouchableOpacity
              style={[styles.actionRow, { backgroundColor: theme.colors.card }]}
              onPress={() => setShowAddModal(true)}
            >
              <Ionicons name="person-add" size={22} color={theme.colors.primary} />
              <Text style={[styles.actionText, { color: theme.colors.primary }]}>
                {t('groups.add_member')}
              </Text>
            </TouchableOpacity>

            {/* View Archived Receipts */}
            <TouchableOpacity
              style={[styles.actionRow, { backgroundColor: theme.colors.card }]}
              onPress={() => {
                fetchArchivedReceipts();
                setShowArchived(true);
              }}
            >
              <Ionicons name="archive-outline" size={22} color={theme.colors.text} />
              <Text style={[styles.actionText, { color: theme.colors.text }]}>
                {t('groups.archived_receipts')}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>

            {/* Leave Group */}
            {user?.id !== creatorId && (
              <TouchableOpacity
                style={[styles.actionRow, { backgroundColor: theme.colors.card }]}
                onPress={handleLeaveGroup}
              >
                <Ionicons name="exit-outline" size={22} color="#ef4444" />
                <Text style={[styles.actionText, { color: '#ef4444' }]}>
                  {t('groups.leave_group')}
                </Text>
              </TouchableOpacity>
            )}

            {/* Delete Group (creator only) */}
            {isCreator && (
              <TouchableOpacity
                style={[styles.actionRow, { backgroundColor: theme.colors.card }]}
                onPress={handleDeleteGroup}
              >
                <Ionicons name="trash-outline" size={22} color="#ef4444" />
                <Text style={[styles.actionText, { color: '#ef4444' }]}>
                  {t('groups.delete_group')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      {/* Add Member Modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
              {t('groups.add_member')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.background, color: theme.colors.text, borderColor: theme.colors.border }]}
              value={addEmail}
              onChangeText={setAddEmail}
              placeholder={t('groups.add_member_by_email')}
              placeholderTextColor={theme.colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: theme.colors.border }]}
                onPress={() => { setShowAddModal(false); setAddEmail(''); }}
              >
                <Text style={{ color: theme.colors.text }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: theme.colors.primary }]}
                onPress={handleAddMember}
                disabled={adding}
              >
                {adding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '600' }}>{t('common.add')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Archived Receipts Modal */}
      <Modal visible={showArchived} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.archivedModal, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.archivedHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                {t('groups.archived_receipts')}
              </Text>
              <TouchableOpacity onPress={() => setShowArchived(false)}>
                <Ionicons name="close" size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={archivedReceipts}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.archivedCard, { backgroundColor: theme.colors.card }]}
                  onPress={() => {
                    setShowArchived(false);
                    navigation.navigate('GroupReceiptSplit', { groupId, receiptId: item.id });
                  }}
                >
                  <Text style={[styles.archivedMerchant, { color: theme.colors.text }]}>
                    {item.merchant_name}
                  </Text>
                  <Text style={[styles.archivedDate, { color: theme.colors.textSecondary }]}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                  <Text style={[styles.archivedAmount, { color: theme.colors.success }]}>
                    {item.total_amount.toFixed(2)} EGP ✓
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  {t('groups.no_archived')}
                </Text>
              }
              contentContainerStyle={{ padding: 16 }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loader: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  list: { padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 16, fontWeight: '500' },
  creatorLabel: { fontSize: 12, marginTop: 2, fontWeight: '600' },
  removeBtn: { padding: 4 },
  footer: { gap: 10, marginTop: 20 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  actionText: { flex: 1, fontSize: 16, fontWeight: '500' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  archivedModal: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' },
  archivedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  archivedCard: { borderRadius: 10, padding: 14, marginBottom: 8 },
  archivedMerchant: { fontSize: 16, fontWeight: '600' },
  archivedDate: { fontSize: 13, marginTop: 4 },
  archivedAmount: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyText: { textAlign: 'center', paddingTop: 40 },
});
