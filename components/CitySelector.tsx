import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CITIES, City } from '../lib/api';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../constants/theme';

interface Props {
  visible: boolean;
  city: City | null;
  required?: boolean;
  onSelect: (city: City) => void;
  onClose?: () => void;
}

export default function CitySelector({ visible, city, required = false, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>📍 Où es-tu ?</Text>
              <Text style={styles.subtitle}>La ville utilisée pour les recommandations et les routes.</Text>
            </View>
            {!required && onClose && (
              <TouchableOpacity onPress={onClose} accessibilityLabel="Fermer">
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <ScrollView contentContainerStyle={styles.grid}>
            {CITIES.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.cityButton, city === option && styles.cityButtonActive]}
                onPress={() => onSelect(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: city === option }}
              >
                <Text style={[styles.cityText, city === option && styles.cityTextActive]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000099' },
  sheet: {
    maxHeight: '72%',
    backgroundColor: COLORS.background,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    paddingBottom: SPACING.xl,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.primary, fontSize: FONT_SIZE.xl, fontWeight: '800' },
  subtitle: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm, marginTop: SPACING.xs, maxWidth: 280 },
  close: { color: COLORS.textSecondary, fontSize: FONT_SIZE.xl, padding: SPACING.sm },
  grid: { padding: SPACING.lg, gap: SPACING.sm },
  cityButton: {
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cityButtonActive: { backgroundColor: COLORS.primarySoft, borderColor: COLORS.primary },
  cityText: { color: COLORS.textSecondary, fontSize: FONT_SIZE.md, fontWeight: '600' },
  cityTextActive: { color: COLORS.primary },
});
