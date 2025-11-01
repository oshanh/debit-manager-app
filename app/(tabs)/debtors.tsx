import AddDebtorModal from '@/components/AddDebtorModal';
import { useDebtors } from '@/database/useDebtors';
import { Debtor } from '@/types/debtor';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View ,RefreshControl} from 'react-native';

export default function DebtorsScreen() {
  const { debtors, loading, error, reload } = useDebtors();
  const [modalVisible, setModalVisible] = useState(false);

  // Reload debtors whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const renderDebtor = ({ item }: { item: Debtor }) => (
    <Link href={`/debtor/${item.id}` as any} asChild>
      <TouchableOpacity
        style={styles.debtorCard}
        activeOpacity={0.8}
      >
        <View style={styles.debtorAvatarWrap}>
          <View style={styles.debtorAvatar}>
            <Text style={styles.debtorAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.debtorInfo}>
          <Text style={styles.debtorName}>{item.name}</Text>
          <View style={styles.debtorRow}>
            <Text style={styles.debtorBalanceIcon}>Rs.
              
            </Text>
            <Text style={styles.debtorBalance}>{item.balance.toFixed(2)}</Text>
          </View>
        </View>
        <View style={styles.arrowContainer}>
          <Text style={styles.arrowText}>››</Text>
          
        </View>
      </TouchableOpacity>
    </Link>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.loadingText}>Loading debtors...</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.loadingText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Debtors</Text>
        <Text style={styles.subtitle}>Total: {debtors.length}</Text>
      </View>

      {debtors.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No debtors found</Text>
          <Text style={styles.emptySubtext}>Add your first debtor to get started</Text>
        </View>
      ) : (
        <FlatList
          data={debtors}
          renderItem={renderDebtor}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={reload}
            />
          }
        />)}

      {/* Floating Add Button */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => setModalVisible(true)}
      >
        <View style={styles.fabInner}>
          <Text style={styles.fabIcon}>+</Text>
        </View>
      </TouchableOpacity>

      <AddDebtorModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25292e',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#25292e',
  },
  header: {
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#1a1d21',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ba1a6',
  },
  listContainer: {
    padding: 16,
  },
  debtorCard: {
    backgroundColor: '#1a1d21',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  debtorAvatarWrap: {
    marginRight: 16,
  },
  debtorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0606fab6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  debtorAvatarText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  debtorInfo: {
    flex: 1,
    gap: 2,
  },
  debtorName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 2,
  },
  debtorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    gap: 4,
  },
  debtorBalanceIcon: {
    fontSize: 16,
    color: '#f59e42',
    marginRight: 2,
  },
  debtorBalance: {
    fontSize: 16,
    color: '#f59e42',
    fontWeight: '600',
  },
  debtorPhoneIcon: {
    fontSize: 15,
    color: '#3b82f6',
    marginRight: 2,
  },
  debtorPhones: {
    fontSize: 14,
    color: '#9ba1a6',
    fontWeight: '500',
  },
  arrowContainer: {
    justifyContent: 'center',
    paddingLeft: 12,
  },
  arrowText: {
    fontSize: 32,
    color: '#00bfffff',
    fontWeight: '300',
  },
  loadingText: {
    fontSize: 18,
    color: '#9ba1a6',
  },
  emptyText: {
    fontSize: 20,
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 16,
    color: '#9ba1a6',
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 32,
    zIndex: 10,
    elevation: 5,
  },
  fabInner: {
    backgroundColor: '#0808dbff',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  fabIcon: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
    marginTop: -2,
  },
});
