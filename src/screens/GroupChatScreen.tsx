import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../services/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../services/supabase';
import { analyzeReceiptWithOCRSpace } from '../services/ocrSpaceAPI';
import {
  loadGroupMessages,
  loadGroupMembers,
  sendGroupMessage,
  createGroupReceiptFromOCR,
} from '../services/groupService';
import type { GroupMessage } from '../services/groupService';
import { GroupMessageItem } from '../components/GroupMessageItem';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'GroupChat'>;

export default function GroupChatScreen({ navigation, route }: Props) {
  const { groupId, groupName } = route.params;
  const { user } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const data = await loadGroupMessages(groupId);
      setMessages(data);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchMessages();

    // Subscribe to real-time messages
    const subscription = supabase
      .channel(`group-messages-${groupId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [
              ...prev,
              {
                id: newMsg.id,
                group_id: newMsg.group_id,
                sender_id: newMsg.sender_id,
                sender_name: newMsg.sender_name ?? 'Unknown',
                content: newMsg.message_text ?? newMsg.content,
                message_type: newMsg.message_type ?? 'text',
                receipt_id: newMsg.receipt_id,
                created_at: newMsg.sent_at ?? newMsg.created_at,
              },
            ];
          });
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [groupId, fetchMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const handleSend = async () => {
    if (!inputText.trim() || !user) return;

    const text = inputText.trim();
    setInputText('');
    setSending(true);

    // Optimistic update - show immediately
    const optimistic: GroupMessage = {
      id: `temp-${Date.now()}`,
      group_id: groupId,
      sender_id: user.id,
      sender_name: 'You',
      content: text,
      message_type: 'text',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await sendGroupMessage(groupId, user.id, text);
    } catch (error) {
      console.error('Error sending message:', error);
      // Revert optimistic update on error
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      Alert.alert(t('common.error'), t('common.error'));
    } finally {
      setSending(false);
    }
  };

  const handleUploadReceipt = () => {
    Alert.alert(t('groups.upload_receipt'), t('split.scan_receipt_choose'), [
      {
        text: t('split.take_photo'),
        onPress: () => captureAndAnalyzeReceipt('camera'),
      },
      {
        text: t('split.choose_from_gallery'),
        onPress: () => captureAndAnalyzeReceipt('gallery'),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const captureAndAnalyzeReceipt = async (source: 'camera' | 'gallery') => {
    if (!user) {
      Alert.alert(t('common.error'), 'You must be logged in');
      return;
    }

    try {
      // Step 1: Get image
      let result;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('common.permission_required'), t('scan.permission_required'));
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
          allowsEditing: true,
          aspect: [3, 4],
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('common.permission_required'), t('scan.permission_required'));
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
          allowsEditing: true,
          aspect: [3, 4],
        });
      }

      if (result.canceled || !result.assets?.[0]) {
        console.log('Image selection cancelled');
        return;
      }

      console.log('📸 Image selected:', result.assets[0].uri);
      setSending(true);

      // Step 2: Upload image to storage (optional – proceed even if upload fails)
      let receiptImageUrl: string | undefined;
      try {
        const imageUri = result.assets[0].uri;
        const response = await fetch(imageUri);
        const blob = await response.blob();
        const fileName = `group-receipt-${Date.now()}.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('receipts')
          .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
        if (!uploadError && uploadData) {
          const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(fileName);
          receiptImageUrl = urlData.publicUrl;
          console.log('✅ Receipt image uploaded:', receiptImageUrl);
        } else {
          console.warn('⚠️ Receipt image upload skipped:', uploadError?.message);
        }
      } catch (uploadErr) {
        console.warn('⚠️ Receipt image upload failed:', uploadErr);
      }

      // Step 3: Analyze with OCR
      console.log('🔍 Analyzing receipt with OCR...');
      const receiptData = await analyzeReceiptWithOCRSpace(result.assets[0].uri);

      console.log('✅ OCR completed:', {
        merchant: receiptData.merchantName,
        total: receiptData.total,
        itemCount: receiptData.items.length,
      });

      // Step 4: Fetch group members
      console.log('👥 Fetching group members...');
      const members = await loadGroupMembers(groupId);

      console.log('✅ Found', members.length, 'members');

      setSending(false);

      // Step 5: Show "Who Paid?" prompt
      await new Promise<void>((resolve) => {
        const buttons = members.map((member) => ({
          text: member.user_id === user.id ? `${member.name} (You)` : member.name,
          onPress: async () => {
            try {
              setSending(true);
              console.log('💾 Creating receipt with payer:', member.user_id);

              // ✅ CORRECT PARAMETER ORDER!
              const receipt = await createGroupReceiptFromOCR(
                groupId, // 1️⃣ Group UUID
                user.id, // 2️⃣ Uploader UUID
                member.user_id, // 3️⃣ Payer UUID ✅
                receiptData.merchantName || 'Unknown Store', // 4️⃣ Merchant name ✅
                receiptData.total, // 5️⃣ Total amount ✅
                receiptData.items.map((item) => ({
                  // 6️⃣ Items array ✅
                  name: item.name,
                  price: item.price,
                  quantity: item.quantity || 1,
                })),
                receiptImageUrl, // 7️⃣ Image URL ✅
                receiptData.subtotal, // 8️⃣ Subtotal ✅
                receiptData.taxAmount, // 9️⃣ Tax amount ✅
                receiptData.serviceCharge, // 🔟 Service charge ✅
                receiptData.deliveryFee, // 1️⃣1️⃣ Delivery fee ✅
                receiptData.discount // 1️⃣2️⃣ Discount ✅
              );

              console.log('✅ Receipt created:', receipt.id);

              // Send message
              const payerName = member.user_id === user.id ? 'You' : member.name;
              await sendGroupMessage(
                groupId,
                user.id,
                `📝 ${payerName} paid: ${receiptData.merchantName || 'Receipt'} - ${receiptData.total.toFixed(2)} EGP`,
                'receipt',
                receipt.id
              );

              console.log('✅ Receipt message sent');

              Alert.alert(
                t('common.success'),
                `Receipt uploaded! ${receiptData.items.length} items found. Tap to split!`
              );

              resolve();
            } catch (error: any) {
              console.error('❌ Error creating receipt:', error);
              Alert.alert(t('common.error'), error?.message || t('split.scan_receipt_error'));
              resolve();
            } finally {
              setSending(false);
            }
          },
        }));

        buttons.push({
          text: t('common.cancel'),
          onPress: () => resolve(),
          style: 'cancel',
        } as any);

        Alert.alert(t('groups.who_paid'), t('groups.select_who_paid_receipt'), buttons);
      });
    } catch (error: any) {
      console.error('❌ Error uploading receipt:', error);
      Alert.alert(t('common.error'), error?.message || t('split.scan_receipt_error'));
    } finally {
      setSending(false);
    }
  };

  const handleReceiptPress = (receiptId: string) => {
    console.log('📄 Opening receipt:', receiptId);
    navigation.navigate('GroupReceiptSplit', { groupId, receiptId });
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border },
        ]}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={[styles.headerAvatar, { backgroundColor: theme.colors.primary }]}>
          <Ionicons name="people" size={20} color="#fff" />
        </View>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]} numberOfLines={1}>
          {groupName}
        </Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => navigation.navigate('GroupSettings', { groupId, groupName })}
        >
          <Ionicons name="settings-outline" size={22} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      {loading ? (
        <ActivityIndicator size="large" color={theme.colors.primary} style={styles.loader} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <GroupMessageItem
              message={item}
              isOwnMessage={item.sender_id === user?.id}
              onReceiptPress={handleReceiptPress}
            />
          )}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textSecondary} />
              <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                {t('groups.no_messages')}
              </Text>
            </View>
          }
        />
      )}

      {/* Input */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={[
            styles.inputRow,
            { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
          ]}
        >
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handleUploadReceipt}
            disabled={sending}
          >
            <Ionicons
              name="receipt-outline"
              size={24}
              color={sending ? theme.colors.textSecondary : theme.colors.primary}
            />
          </TouchableOpacity>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.colors.background, color: theme.colors.text },
            ]}
            value={inputText}
            onChangeText={setInputText}
            placeholder={t('groups.type_message')}
            placeholderTextColor={theme.colors.textSecondary}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              { backgroundColor: theme.colors.primary, opacity: inputText.trim() ? 1 : 0.5 },
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
  },
  backButton: { padding: 4, marginRight: 8 },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600' },
  settingsBtn: { padding: 4, marginLeft: 4 },
  loader: { flex: 1 },
  messageList: { paddingVertical: 12 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 12 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  attachBtn: { padding: 8, alignSelf: 'flex-end' },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-end',
  },
});
