export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      checkin_log: {
        Row: {
          created_at: string
          device_label: string | null
          event_id: string | null
          id: string
          result: string
          ticket_id: string | null
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          event_id?: string | null
          id?: string
          result: string
          ticket_id?: string | null
        }
        Update: {
          created_at?: string
          device_label?: string | null
          event_id?: string | null
          id?: string
          result?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkin_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkin_log_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          event_id: string
          id: string
          max_uses: number | null
          type: string
          used_count: number
          valid_from: string | null
          valid_until: string | null
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          event_id: string
          id?: string
          max_uses?: number | null
          type: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          event_id?: string
          id?: string
          max_uses?: number | null
          type?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupons_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          organizer_id: string
          qr_secret: string
          slug: string
          starts_at: string
          status: string
          timezone: string
          title: string
          venue_address: string | null
          venue_name: string | null
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          organizer_id: string
          qr_secret?: string
          slug: string
          starts_at: string
          status?: string
          timezone?: string
          title: string
          venue_address?: string | null
          venue_name?: string | null
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          organizer_id?: string
          qr_secret?: string
          slug?: string
          starts_at?: string
          status?: string
          timezone?: string
          title?: string
          venue_address?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          quantity: number
          ticket_type_id: string
          unit_price_cents: number
        }
        Insert: {
          id?: string
          order_id: string
          quantity: number
          ticket_type_id: string
          unit_price_cents: number
        }
        Update: {
          id?: string
          order_id?: string
          quantity?: number
          ticket_type_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_email: string
          buyer_name: string | null
          buyer_phone: string | null
          coupon_id: string | null
          created_at: string
          discount_cents: number
          event_id: string
          expires_at: string | null
          fee_cents: number
          gopay_payment_id: string | null
          id: string
          paid_at: string | null
          status: string
          subtotal_cents: number
          total_cents: number
        }
        Insert: {
          buyer_email: string
          buyer_name?: string | null
          buyer_phone?: string | null
          coupon_id?: string | null
          created_at?: string
          discount_cents?: number
          event_id: string
          expires_at?: string | null
          fee_cents?: number
          gopay_payment_id?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          subtotal_cents?: number
          total_cents?: number
        }
        Update: {
          buyer_email?: string
          buyer_name?: string | null
          buyer_phone?: string | null
          coupon_id?: string | null
          created_at?: string
          discount_cents?: number
          event_id?: string
          expires_at?: string | null
          fee_cents?: number
          gopay_payment_id?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          subtotal_cents?: number
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      organizer_members: {
        Row: {
          created_at: string
          id: string
          organizer_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organizer_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organizer_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizer_members_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "organizers"
            referencedColumns: ["id"]
          },
        ]
      }
      organizers: {
        Row: {
          created_at: string
          dic: string | null
          email: string | null
          fee_min_cents: number
          fee_percent: number
          gopay_goid: string | null
          iban: string | null
          ic_dph: string | null
          ico: string | null
          id: string
          name: string
          phone: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          dic?: string | null
          email?: string | null
          fee_min_cents?: number
          fee_percent?: number
          gopay_goid?: string | null
          iban?: string | null
          ic_dph?: string | null
          ico?: string | null
          id?: string
          name: string
          phone?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          dic?: string | null
          email?: string | null
          fee_min_cents?: number
          fee_percent?: number
          gopay_goid?: string | null
          iban?: string | null
          ic_dph?: string | null
          ico?: string | null
          id?: string
          name?: string
          phone?: string | null
          slug?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          created_at: string
          gopay_payment_id: string
          id: string
          order_id: string | null
          raw: Json | null
          state: string
        }
        Insert: {
          created_at?: string
          gopay_payment_id: string
          id?: string
          order_id?: string | null
          raw?: Json | null
          state: string
        }
        Update: {
          created_at?: string
          gopay_payment_id?: string
          id?: string
          order_id?: string | null
          raw?: Json | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_types: {
        Row: {
          capacity: number
          created_at: string
          currency: string
          description: string | null
          event_id: string
          hidden: boolean
          id: string
          max_per_order: number
          name: string
          price_cents: number
          sale_ends_at: string | null
          sale_starts_at: string | null
          sold_count: number
          sort_order: number
        }
        Insert: {
          capacity: number
          created_at?: string
          currency?: string
          description?: string | null
          event_id: string
          hidden?: boolean
          id?: string
          max_per_order?: number
          name: string
          price_cents: number
          sale_ends_at?: string | null
          sale_starts_at?: string | null
          sold_count?: number
          sort_order?: number
        }
        Update: {
          capacity?: number
          created_at?: string
          currency?: string
          description?: string | null
          event_id?: string
          hidden?: boolean
          id?: string
          max_per_order?: number
          name?: string
          price_cents?: number
          sale_ends_at?: string | null
          sale_starts_at?: string | null
          sold_count?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          checked_in_by: string | null
          created_at: string
          event_id: string
          holder_name: string | null
          id: string
          order_id: string
          status: string
          ticket_type_id: string
          used_at: string | null
        }
        Insert: {
          checked_in_by?: string | null
          created_at?: string
          event_id: string
          holder_name?: string | null
          id?: string
          order_id: string
          status?: string
          ticket_type_id: string
          used_at?: string | null
        }
        Update: {
          checked_in_by?: string | null
          created_at?: string
          event_id?: string
          holder_name?: string | null
          id?: string
          order_id?: string
          status?: string
          ticket_type_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_coupon_use: {
        Args: { p_coupon_id: string }
        Returns: undefined
      }
      is_org_member: { Args: { p_org: string }; Returns: boolean }
      release_expired_orders: { Args: never; Returns: number }
      release_ticket_capacity: {
        Args: { p_qty: number; p_ticket_type_id: string }
        Returns: undefined
      }
      reserve_ticket_capacity: {
        Args: { p_qty: number; p_ticket_type_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
