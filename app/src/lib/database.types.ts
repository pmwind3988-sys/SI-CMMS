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
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      apk_builds: {
        Row: {
          apk_path: string | null
          apk_sha256: string | null
          apk_size_bytes: number | null
          application_id: string
          build_type: Database["public"]["Enums"]["si_build_type"]
          built_at: string
          built_by: string | null
          created_at: string
          download_url: string | null
          git_branch: string | null
          git_sha: string | null
          id: string
          min_supported_version_code: number | null
          release_notes: string | null
          released: boolean
          updated_at: string
          version_code: number
          version_name: string
          web_build_id: string | null
        }
        Insert: {
          apk_path?: string | null
          apk_sha256?: string | null
          apk_size_bytes?: number | null
          application_id: string
          build_type: Database["public"]["Enums"]["si_build_type"]
          built_at?: string
          built_by?: string | null
          created_at?: string
          download_url?: string | null
          git_branch?: string | null
          git_sha?: string | null
          id: string
          min_supported_version_code?: number | null
          release_notes?: string | null
          released?: boolean
          updated_at?: string
          version_code: number
          version_name: string
          web_build_id?: string | null
        }
        Update: {
          apk_path?: string | null
          apk_sha256?: string | null
          apk_size_bytes?: number | null
          application_id?: string
          build_type?: Database["public"]["Enums"]["si_build_type"]
          built_at?: string
          built_by?: string | null
          created_at?: string
          download_url?: string | null
          git_branch?: string | null
          git_sha?: string | null
          id?: string
          min_supported_version_code?: number | null
          release_notes?: string | null
          released?: boolean
          updated_at?: string
          version_code?: number
          version_name?: string
          web_build_id?: string | null
        }
        Relationships: []
      }
      assets: {
        Row: {
          asset_code: string
          category: string | null
          created_at: string
          criticality: Database["public"]["Enums"]["si_criticality"] | null
          department_id: string
          id: string
          install_date: string | null
          manufacturer: string | null
          meter_reading: number | null
          meter_unit: string | null
          model: string | null
          name: string
          photo_url: string | null
          plant_id: string | null
          qr_code: string | null
          serial_number: string | null
          status: Database["public"]["Enums"]["si_asset_status"]
          updated_at: string
          warranty_expiry: string | null
        }
        Insert: {
          asset_code: string
          category?: string | null
          created_at?: string
          criticality?: Database["public"]["Enums"]["si_criticality"] | null
          department_id: string
          id: string
          install_date?: string | null
          manufacturer?: string | null
          meter_reading?: number | null
          meter_unit?: string | null
          model?: string | null
          name: string
          photo_url?: string | null
          plant_id?: string | null
          qr_code?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["si_asset_status"]
          updated_at?: string
          warranty_expiry?: string | null
        }
        Update: {
          asset_code?: string
          category?: string | null
          created_at?: string
          criticality?: Database["public"]["Enums"]["si_criticality"] | null
          department_id?: string
          id?: string
          install_date?: string | null
          manufacturer?: string | null
          meter_reading?: number | null
          meter_unit?: string | null
          model?: string | null
          name?: string
          photo_url?: string | null
          plant_id?: string | null
          qr_code?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["si_asset_status"]
          updated_at?: string
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          entity_id: string
          entity_type: Database["public"]["Enums"]["si_entity_type"]
          file_size_bytes: number | null
          file_type: Database["public"]["Enums"]["si_file_type"]
          file_url: string
          id: string
          storage_path: string | null
          uploaded_at: string
          uploaded_by_id: string
          uploaded_by_role: Database["public"]["Enums"]["si_role"] | null
        }
        Insert: {
          entity_id: string
          entity_type: Database["public"]["Enums"]["si_entity_type"]
          file_size_bytes?: number | null
          file_type?: Database["public"]["Enums"]["si_file_type"]
          file_url: string
          id?: string
          storage_path?: string | null
          uploaded_at?: string
          uploaded_by_id: string
          uploaded_by_role?: Database["public"]["Enums"]["si_role"] | null
        }
        Update: {
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["si_entity_type"]
          file_size_bytes?: number | null
          file_type?: Database["public"]["Enums"]["si_file_type"]
          file_url?: string
          id?: string
          storage_path?: string | null
          uploaded_at?: string
          uploaded_by_id?: string
          uploaded_by_role?: Database["public"]["Enums"]["si_role"] | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          author_name: string | null
          author_role: Database["public"]["Enums"]["si_role"] | null
          created_at: string
          edited_at: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["si_entity_type"]
          id: string
          text: string
        }
        Insert: {
          author_id: string
          author_name?: string | null
          author_role?: Database["public"]["Enums"]["si_role"] | null
          created_at?: string
          edited_at?: string | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["si_entity_type"]
          id?: string
          text: string
        }
        Update: {
          author_id?: string
          author_name?: string | null
          author_role?: Database["public"]["Enums"]["si_role"] | null
          created_at?: string
          edited_at?: string | null
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["si_entity_type"]
          id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      counters: {
        Row: {
          id: string
          last_value: number
        }
        Insert: {
          id: string
          last_value?: number
        }
        Update: {
          id?: string
          last_value?: number
        }
        Relationships: []
      }
      departments: {
        Row: {
          code: string
          created_at: string
          id: string
          manager_id: string | null
          name: string
          plant_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id: string
          manager_id?: string | null
          name: string
          plant_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          manager_id?: string | null
          name?: string
          plant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
        ]
      }
      impact_levels: {
        Row: {
          code: Database["public"]["Enums"]["si_impact"]
          created_at: string
          description: string | null
          label: string
          sort_order: number
          suggests_priority: Database["public"]["Enums"]["si_priority"]
          updated_at: string
        }
        Insert: {
          code: Database["public"]["Enums"]["si_impact"]
          created_at?: string
          description?: string | null
          label: string
          sort_order: number
          suggests_priority: Database["public"]["Enums"]["si_priority"]
          updated_at?: string
        }
        Update: {
          code?: Database["public"]["Enums"]["si_impact"]
          created_at?: string
          description?: string | null
          label?: string
          sort_order?: number
          suggests_priority?: Database["public"]["Enums"]["si_priority"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "impact_levels_suggests_priority_fkey"
            columns: ["suggests_priority"]
            isOneToOne: false
            referencedRelation: "priorities"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          failed_count: number
          first_failed: string
          identifier: string
          locked_until: string | null
        }
        Insert: {
          failed_count?: number
          first_failed?: string
          identifier: string
          locked_until?: string | null
        }
        Update: {
          failed_count?: number
          first_failed?: string
          identifier?: string
          locked_until?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string
          entity_label: string | null
          entity_type: Database["public"]["Enums"]["si_entity_type"]
          id: string
          recipient_id: string
          recipient_role: Database["public"]["Enums"]["si_role"] | null
          status: Database["public"]["Enums"]["si_notif_status"]
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id: string
          entity_label?: string | null
          entity_type?: Database["public"]["Enums"]["si_entity_type"]
          id?: string
          recipient_id: string
          recipient_role?: Database["public"]["Enums"]["si_role"] | null
          status?: Database["public"]["Enums"]["si_notif_status"]
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string
          entity_label?: string | null
          entity_type?: Database["public"]["Enums"]["si_entity_type"]
          id?: string
          recipient_id?: string
          recipient_role?: Database["public"]["Enums"]["si_role"] | null
          status?: Database["public"]["Enums"]["si_notif_status"]
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      plants: {
        Row: {
          address: Json | null
          code: string | null
          created_at: string
          id: string
          name: string
          status: Database["public"]["Enums"]["si_user_status"] | null
          timezone: string | null
        }
        Insert: {
          address?: Json | null
          code?: string | null
          created_at?: string
          id: string
          name: string
          status?: Database["public"]["Enums"]["si_user_status"] | null
          timezone?: string | null
        }
        Update: {
          address?: Json | null
          code?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["si_user_status"] | null
          timezone?: string | null
        }
        Relationships: []
      }
      priorities: {
        Row: {
          code: Database["public"]["Enums"]["si_priority"]
          color_hex: string | null
          created_at: string
          description: string | null
          id: Database["public"]["Enums"]["si_priority"]
          label: string
          rank: number | null
          updated_at: string
        }
        Insert: {
          code: Database["public"]["Enums"]["si_priority"]
          color_hex?: string | null
          created_at?: string
          description?: string | null
          id: Database["public"]["Enums"]["si_priority"]
          label: string
          rank?: number | null
          updated_at?: string
        }
        Update: {
          code?: Database["public"]["Enums"]["si_priority"]
          color_hex?: string | null
          created_at?: string
          description?: string | null
          id?: Database["public"]["Enums"]["si_priority"]
          label?: string
          rank?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          can_delete_work_orders: boolean
          role: Database["public"]["Enums"]["si_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          can_delete_work_orders?: boolean
          role: Database["public"]["Enums"]["si_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          can_delete_work_orders?: boolean
          role?: Database["public"]["Enums"]["si_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_severities: {
        Row: {
          code: string
          created_at: string
          escalates_to_priority: Database["public"]["Enums"]["si_priority"]
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          escalates_to_priority: Database["public"]["Enums"]["si_priority"]
          label: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          escalates_to_priority?: Database["public"]["Enums"]["si_priority"]
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_severities_escalates_to_priority_fkey"
            columns: ["escalates_to_priority"]
            isOneToOne: false
            referencedRelation: "priorities"
            referencedColumns: ["id"]
          },
        ]
      }
      sla: {
        Row: {
          ack_target_label: string | null
          ack_target_minutes: number
          created_at: string
          id: string
          plant_id: string | null
          priority_id: Database["public"]["Enums"]["si_priority"]
          resolution_target_label: string | null
          resolution_target_minutes: number
          response_target_label: string | null
          response_target_minutes: number | null
          updated_at: string
        }
        Insert: {
          ack_target_label?: string | null
          ack_target_minutes: number
          created_at?: string
          id: string
          plant_id?: string | null
          priority_id: Database["public"]["Enums"]["si_priority"]
          resolution_target_label?: string | null
          resolution_target_minutes: number
          response_target_label?: string | null
          response_target_minutes?: number | null
          updated_at?: string
        }
        Update: {
          ack_target_label?: string | null
          ack_target_minutes?: number
          created_at?: string
          id?: string
          plant_id?: string | null
          priority_id?: Database["public"]["Enums"]["si_priority"]
          resolution_target_label?: string | null
          resolution_target_minutes?: number
          response_target_label?: string | null
          response_target_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_priority_id_fkey"
            columns: ["priority_id"]
            isOneToOne: false
            referencedRelation: "priorities"
            referencedColumns: ["id"]
          },
        ]
      }
      stats: {
        Row: {
          data: Json
          id: string
          updated_at: string
        }
        Insert: {
          data?: Json
          id: string
          updated_at?: string
        }
        Update: {
          data?: Json
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      technicians: {
        Row: {
          availability_status: Database["public"]["Enums"]["si_availability"]
          certifications: string[]
          created_at: string
          current_load: number
          name: string | null
          plant_ids: string[]
          skills: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          availability_status?: Database["public"]["Enums"]["si_availability"]
          certifications?: string[]
          created_at?: string
          current_load?: number
          name?: string | null
          plant_ids?: string[]
          skills?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          availability_status?: Database["public"]["Enums"]["si_availability"]
          certifications?: string[]
          created_at?: string
          current_load?: number
          name?: string | null
          plant_ids?: string[]
          skills?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technicians_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          department_id: string | null
          email: string
          employee_id: string | null
          id: string
          is_protected: boolean
          is_test_account: boolean
          last_login_at: string | null
          must_change_password: boolean
          name: string
          password_changed_at: string | null
          phone: string | null
          photo_url: string | null
          plant_ids: string[]
          roles: Database["public"]["Enums"]["si_role"][]
          seed_name: string | null
          seed_phone: string | null
          seed_source: string | null
          seeded_at: string | null
          status: Database["public"]["Enums"]["si_user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          email: string
          employee_id?: string | null
          id: string
          is_protected?: boolean
          is_test_account?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          name: string
          password_changed_at?: string | null
          phone?: string | null
          photo_url?: string | null
          plant_ids?: string[]
          roles: Database["public"]["Enums"]["si_role"][]
          seed_name?: string | null
          seed_phone?: string | null
          seed_source?: string | null
          seeded_at?: string | null
          status?: Database["public"]["Enums"]["si_user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          email?: string
          employee_id?: string | null
          id?: string
          is_protected?: boolean
          is_test_account?: boolean
          last_login_at?: string | null
          must_change_password?: boolean
          name?: string
          password_changed_at?: string | null
          phone?: string | null
          photo_url?: string | null
          plant_ids?: string[]
          roles?: Database["public"]["Enums"]["si_role"][]
          seed_name?: string | null
          seed_phone?: string | null
          seed_source?: string | null
          seeded_at?: string | null
          status?: Database["public"]["Enums"]["si_user_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      wo_status_transitions: {
        Row: {
          from_status: Database["public"]["Enums"]["si_wo_status"]
          label: string | null
          requires: string[]
          requires_assignee_change: boolean
          roles: Database["public"]["Enums"]["si_role"][]
          to_status: Database["public"]["Enums"]["si_wo_status"]
        }
        Insert: {
          from_status: Database["public"]["Enums"]["si_wo_status"]
          label?: string | null
          requires?: string[]
          requires_assignee_change?: boolean
          roles: Database["public"]["Enums"]["si_role"][]
          to_status: Database["public"]["Enums"]["si_wo_status"]
        }
        Update: {
          from_status?: Database["public"]["Enums"]["si_wo_status"]
          label?: string | null
          requires?: string[]
          requires_assignee_change?: boolean
          roles?: Database["public"]["Enums"]["si_role"][]
          to_status?: Database["public"]["Enums"]["si_wo_status"]
        }
        Relationships: []
      }
      wo_statuses: {
        Row: {
          code: Database["public"]["Enums"]["si_wo_status"]
          color_hex: string
          created_at: string
          description: string | null
          is_terminal: boolean
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: Database["public"]["Enums"]["si_wo_status"]
          color_hex?: string
          created_at?: string
          description?: string | null
          is_terminal?: boolean
          label: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: Database["public"]["Enums"]["si_wo_status"]
          color_hex?: string
          created_at?: string
          description?: string | null
          is_terminal?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      wo_types: {
        Row: {
          code: Database["public"]["Enums"]["si_wo_type"]
          created_at: string
          description: string | null
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: Database["public"]["Enums"]["si_wo_type"]
          created_at?: string
          description?: string | null
          label: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: Database["public"]["Enums"]["si_wo_type"]
          created_at?: string
          description?: string | null
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      work_order_deletions: {
        Row: {
          asset_name: string | null
          assigned_to_name: string | null
          deleted_at: string
          deleted_by: string | null
          deleted_by_name: string | null
          deleted_by_role: string | null
          department_id: string | null
          id: string
          priority: string | null
          raised_at: string | null
          requester_name: string | null
          snapshot: Json
          status: string | null
          wo_number: string | null
          work_order_id: string
        }
        Insert: {
          asset_name?: string | null
          assigned_to_name?: string | null
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          deleted_by_role?: string | null
          department_id?: string | null
          id?: string
          priority?: string | null
          raised_at?: string | null
          requester_name?: string | null
          snapshot: Json
          status?: string | null
          wo_number?: string | null
          work_order_id: string
        }
        Update: {
          asset_name?: string | null
          assigned_to_name?: string | null
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string | null
          deleted_by_role?: string | null
          department_id?: string | null
          id?: string
          priority?: string | null
          raised_at?: string | null
          requester_name?: string | null
          snapshot?: Json
          status?: string | null
          wo_number?: string | null
          work_order_id?: string
        }
        Relationships: []
      }
      work_order_history: {
        Row: {
          actor_id: string
          actor_name: string | null
          actor_role: Database["public"]["Enums"]["si_role"] | null
          created_at: string
          from_status: Database["public"]["Enums"]["si_wo_status"] | null
          id: string
          remarks: string | null
          to_status: Database["public"]["Enums"]["si_wo_status"]
          work_order_id: string
        }
        Insert: {
          actor_id: string
          actor_name?: string | null
          actor_role?: Database["public"]["Enums"]["si_role"] | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["si_wo_status"] | null
          id?: string
          remarks?: string | null
          to_status: Database["public"]["Enums"]["si_wo_status"]
          work_order_id: string
        }
        Update: {
          actor_id?: string
          actor_name?: string | null
          actor_role?: Database["public"]["Enums"]["si_role"] | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["si_wo_status"] | null
          id?: string
          remarks?: string | null
          to_status?: Database["public"]["Enums"]["si_wo_status"]
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_history_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          area: string | null
          asset_id: string
          asset_name: string | null
          assigned_to_id: string | null
          assigned_to_name: string | null
          client_uuid: string | null
          closed_at: string | null
          created_at: string
          decline_count: number
          decline_reason: string | null
          department_id: string
          description: string
          environmental_risk: Json
          est_downtime_unit:
            | Database["public"]["Enums"]["si_downtime_unit"]
            | null
          est_downtime_value: number | null
          id: string
          impact: Database["public"]["Enums"]["si_impact"] | null
          permit_required: boolean
          plant_id: string | null
          priority: Database["public"]["Enums"]["si_priority"]
          priority_touched: boolean
          reopen_reason: string | null
          requester_id: string
          requester_name: string | null
          requester_phone: string | null
          resolution_notes: string | null
          resolved_at: string | null
          safety_risk: Json
          sla_ack_due_at: string | null
          sla_breached: boolean
          sla_resolution_due_at: string | null
          sla_warning_sent: boolean
          spare_part_reason: string | null
          status: Database["public"]["Enums"]["si_wo_status"]
          test_fail_reason: string | null
          type: Database["public"]["Enums"]["si_wo_type"] | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          wo_number: string | null
        }
        Insert: {
          area?: string | null
          asset_id: string
          asset_name?: string | null
          assigned_to_id?: string | null
          assigned_to_name?: string | null
          client_uuid?: string | null
          closed_at?: string | null
          created_at?: string
          decline_count?: number
          decline_reason?: string | null
          department_id: string
          description: string
          environmental_risk?: Json
          est_downtime_unit?:
            | Database["public"]["Enums"]["si_downtime_unit"]
            | null
          est_downtime_value?: number | null
          id?: string
          impact?: Database["public"]["Enums"]["si_impact"] | null
          permit_required?: boolean
          plant_id?: string | null
          priority: Database["public"]["Enums"]["si_priority"]
          priority_touched?: boolean
          reopen_reason?: string | null
          requester_id: string
          requester_name?: string | null
          requester_phone?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          safety_risk?: Json
          sla_ack_due_at?: string | null
          sla_breached?: boolean
          sla_resolution_due_at?: string | null
          sla_warning_sent?: boolean
          spare_part_reason?: string | null
          status?: Database["public"]["Enums"]["si_wo_status"]
          test_fail_reason?: string | null
          type?: Database["public"]["Enums"]["si_wo_type"] | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          wo_number?: string | null
        }
        Update: {
          area?: string | null
          asset_id?: string
          asset_name?: string | null
          assigned_to_id?: string | null
          assigned_to_name?: string | null
          client_uuid?: string | null
          closed_at?: string | null
          created_at?: string
          decline_count?: number
          decline_reason?: string | null
          department_id?: string
          description?: string
          environmental_risk?: Json
          est_downtime_unit?:
            | Database["public"]["Enums"]["si_downtime_unit"]
            | null
          est_downtime_value?: number | null
          id?: string
          impact?: Database["public"]["Enums"]["si_impact"] | null
          permit_required?: boolean
          plant_id?: string | null
          priority?: Database["public"]["Enums"]["si_priority"]
          priority_touched?: boolean
          reopen_reason?: string | null
          requester_id?: string
          requester_name?: string | null
          requester_phone?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          safety_risk?: Json
          sla_ack_due_at?: string | null
          sla_breached?: boolean
          sla_resolution_due_at?: string | null
          sla_warning_sent?: boolean
          spare_part_reason?: string | null
          status?: Database["public"]["Enums"]["si_wo_status"]
          test_fail_reason?: string | null
          type?: Database["public"]["Enums"]["si_wo_type"] | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          wo_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_assigned_to_id_fkey"
            columns: ["assigned_to_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_plant_id_fkey"
            columns: ["plant_id"]
            isOneToOne: false
            referencedRelation: "plants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      si_account_rank: {
        Args: {
          p_is_protected: boolean
          p_roles: Database["public"]["Enums"]["si_role"][]
        }
        Returns: number
      }
      si_caller_rank: { Args: never; Returns: number }
      si_can_delete_work_orders: { Args: never; Returns: boolean }
      si_compute_dashboard_stats: { Args: never; Returns: undefined }
      si_dashboard_card_rows: {
        Args: { p_card: string; p_limit?: number }
        Returns: {
          kind: string
          meta: string
          metric_kind: string
          metric_value: number
          occurred_at: string
          priority: string
          ref_id: string
          status: string
          subtitle: string
          title: string
        }[]
      }
      si_department_id: { Args: never; Returns: string }
      si_department_supervisors: {
        Args: { p_department_id: string }
        Returns: string[]
      }
      si_dummy_flags: {
        Args: { u: Database["public"]["Tables"]["users"]["Row"] }
        Returns: string[]
      }
      si_eligible_roles: {
        Args: {
          p_assigned_to: string
          p_requester: string
          p_transition_roles: Database["public"]["Enums"]["si_role"][]
        }
        Returns: Database["public"]["Enums"]["si_role"][]
      }
      si_email_by_employee_id: {
        Args: { p_employee_id: string }
        Returns: string
      }
      si_has_role: { Args: { p_role: string }; Returns: boolean }
      si_in_same_department: { Args: { dept: string }; Returns: boolean }
      si_is_admin: { Args: never; Returns: boolean }
      si_is_manager: { Args: never; Returns: boolean }
      si_is_manager_or_admin: { Args: never; Returns: boolean }
      si_is_placeholder_email: { Args: { p_email: string }; Returns: boolean }
      si_is_requester: { Args: never; Returns: boolean }
      si_is_superuser: { Args: never; Returns: boolean }
      si_is_supervisor: { Args: never; Returns: boolean }
      si_is_technician: { Args: never; Returns: boolean }
      si_is_test_account: { Args: { p_user_id: string }; Returns: boolean }
      si_managers: { Args: never; Returns: string[] }
      si_notify: {
        Args: {
          p_body: string
          p_entity_id: string
          p_entity_label: string
          p_recipient_id: string
          p_recipient_role: Database["public"]["Enums"]["si_role"]
          p_title: string
          p_type: string
        }
        Returns: undefined
      }
      si_open_statuses: {
        Args: never
        Returns: Database["public"]["Enums"]["si_wo_status"][]
      }
      si_protected_override: { Args: never; Returns: boolean }
      si_rank: {
        Args: {
          p_protected?: boolean
          p_role: Database["public"]["Enums"]["si_role"]
        }
        Returns: number
      }
      si_refresh_dashboard_stats: { Args: never; Returns: Json }
      si_role: { Args: never; Returns: string }
      si_role_rank: { Args: { p_role: string }; Returns: number }
      si_roles: {
        Args: never
        Returns: Database["public"]["Enums"]["si_role"][]
      }
      si_roles_rank: {
        Args: { p_roles: Database["public"]["Enums"]["si_role"][] }
        Returns: number
      }
      si_set_protected: {
        Args: { p_protected: boolean; p_uid: string }
        Returns: undefined
      }
      si_set_user_roles: {
        Args: {
          p_department_id?: string
          p_plant_ids?: string[]
          p_roles: Database["public"]["Enums"]["si_role"][]
          p_uid: string
        }
        Returns: Json
      }
      si_signed_in: { Args: never; Returns: boolean }
      si_sla_breach_sweep: { Args: never; Returns: number }
      si_sla_target_minutes: {
        Args: { p: Database["public"]["Enums"]["si_priority"] }
        Returns: Record<string, unknown>
      }
      si_sla_warning_sweep: { Args: never; Returns: number }
      si_sweep_login_attempts: { Args: never; Returns: undefined }
      si_terminal_statuses: {
        Args: never
        Returns: Database["public"]["Enums"]["si_wo_status"][]
      }
      si_transition_work_order: {
        Args: {
          p_fields?: Json
          p_remarks?: string
          p_to_status: Database["public"]["Enums"]["si_wo_status"]
          p_via_status?: Database["public"]["Enums"]["si_wo_status"]
          p_wo_id: string
        }
        Returns: {
          area: string | null
          asset_id: string
          asset_name: string | null
          assigned_to_id: string | null
          assigned_to_name: string | null
          client_uuid: string | null
          closed_at: string | null
          created_at: string
          decline_count: number
          decline_reason: string | null
          department_id: string
          description: string
          environmental_risk: Json
          est_downtime_unit:
            | Database["public"]["Enums"]["si_downtime_unit"]
            | null
          est_downtime_value: number | null
          id: string
          impact: Database["public"]["Enums"]["si_impact"] | null
          permit_required: boolean
          plant_id: string | null
          priority: Database["public"]["Enums"]["si_priority"]
          priority_touched: boolean
          reopen_reason: string | null
          requester_id: string
          requester_name: string | null
          requester_phone: string | null
          resolution_notes: string | null
          resolved_at: string | null
          safety_risk: Json
          sla_ack_due_at: string | null
          sla_breached: boolean
          sla_resolution_due_at: string | null
          sla_warning_sent: boolean
          spare_part_reason: string | null
          status: Database["public"]["Enums"]["si_wo_status"]
          test_fail_reason: string | null
          type: Database["public"]["Enums"]["si_wo_type"] | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          wo_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "work_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      si_asset_status:
        | "active"
        | "under_maintenance"
        | "decommissioned"
        | "disposed"
      si_availability: "available" | "busy" | "on_leave"
      si_build_type: "debug" | "release"
      si_criticality: "high" | "medium" | "low"
      si_downtime_unit: "hours" | "days"
      si_entity_type: "work_order" | "asset" | "comment"
      si_file_type: "photo" | "video" | "document"
      si_impact: "full_stoppage" | "reduced_capacity" | "auxiliary" | "none"
      si_notif_status: "sent" | "read"
      si_priority: "P1" | "P2" | "P3" | "P4"
      si_role: "requester" | "technician" | "supervisor" | "manager" | "admin"
      si_user_status: "active" | "inactive"
      si_wo_status:
        | "open"
        | "assigned"
        | "accepted"
        | "on_the_way"
        | "on_site"
        | "repairing"
        | "waiting_spare_part"
        | "testing"
        | "completed"
        | "verified"
        | "closed"
      si_wo_type: "breakdown" | "inspection" | "project"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      si_asset_status: [
        "active",
        "under_maintenance",
        "decommissioned",
        "disposed",
      ],
      si_availability: ["available", "busy", "on_leave"],
      si_build_type: ["debug", "release"],
      si_criticality: ["high", "medium", "low"],
      si_downtime_unit: ["hours", "days"],
      si_entity_type: ["work_order", "asset", "comment"],
      si_file_type: ["photo", "video", "document"],
      si_impact: ["full_stoppage", "reduced_capacity", "auxiliary", "none"],
      si_notif_status: ["sent", "read"],
      si_priority: ["P1", "P2", "P3", "P4"],
      si_role: ["requester", "technician", "supervisor", "manager", "admin"],
      si_user_status: ["active", "inactive"],
      si_wo_status: [
        "open",
        "assigned",
        "accepted",
        "on_the_way",
        "on_site",
        "repairing",
        "waiting_spare_part",
        "testing",
        "completed",
        "verified",
        "closed",
      ],
      si_wo_type: ["breakdown", "inspection", "project"],
    },
  },
} as const
