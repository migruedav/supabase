import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { SITE_ORIGIN } from '~/lib/constants'
import useConfData from '~/components/LaunchWeek/hooks/use-conf-data'
import { Button, IconCheckCircle } from 'ui'
import { SupabaseClient } from '@supabase/supabase-js'
import TicketPresence from './TicketPresence'

type FormState = 'default' | 'loading' | 'error'

export default function TicketForm() {
  const [formState, setFormState] = useState<FormState>('default')
  const [errorMsg] = useState('')
  const { supabase, session, setUserData, ticketState, setTicketState, userData } = useConfData()
  const [realtimeChannel, setRealtimeChannel] = useState<ReturnType<
    SupabaseClient['channel']
  > | null>(null)
  const router = useRouter()

  // Triggered on session
  async function fetchUser() {
    if (supabase && session?.user && !userData.id) {
      const username = session.user.user_metadata.user_name
      const name = session.user.user_metadata.full_name
      const email = session.user.email
      await supabase
        .from('lwx_tickets')
        .insert({ email, name, username, referred_by: router.query?.referral ?? null })
        .eq('email', email)
        .select()
        .single()
        .then(async ({ error }: any) => {
          // If error because of duplicate email, ignore and proceed, otherwise sign out.
          if (error && error?.code !== '23505') {
            setFormState('error')
            return supabase.auth.signOut()
          }
          const { data } = await supabase
            .from('lwx_tickets_golden')
            .select('*')
            .eq('username', username)
            .single()
          if (data) {
            setUserData(data)
          }

          setFormState('default')

          // Prefetch GitHub avatar
          new Image().src = `https://github.com/${username}.png`

          // Prefetch the twitter share URL to eagerly generate the page
          fetch(`/launch-week/x/tickets/${username}`).catch((_) => {})

          // Listen to realtime changes
          if (!realtimeChannel) {
            const channel = supabase
              .channel('changes')
              .on(
                'postgres_changes',
                {
                  event: 'UPDATE',
                  schema: 'public',
                  table: 'lwx_tickets',
                  filter: `username=eq.${username}`,
                },
                (payload: any) => {
                  const golden = !!payload.new.sharedOnTwitter && !!payload.new.sharedOnLinkedIn
                  setUserData({
                    ...payload.new,
                    golden,
                  })
                  if (golden) {
                    channel.unsubscribe()
                  }
                }
              )
              .subscribe()
            setRealtimeChannel(channel)
          }
        })
    }
  }

  useEffect(() => {
    fetchUser()

    return () => {
      // Cleanup realtime subscription on unmount
      realtimeChannel?.unsubscribe()
    }
  }, [session])

  async function handleGithubSignIn() {
    if (formState !== 'default') {
      setFormState('default')
      return
    }

    setFormState('loading')
    setTicketState('loading')

    const redirectTo = `${SITE_ORIGIN}/launch-week/${
      userData.username ? '?referral=' + userData.username : ''
    }`

    supabase?.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo,
      },
    })
  }

  return formState === 'error' ? (
    <div className="h-full">
      <div>{errorMsg}</div>
      <Button
        type="secondary"
        onClick={() => {
          setFormState('default')
          setTicketState('registration')
        }}
      >
        Try Again
      </Button>
    </div>
  ) : (
    <div className="flex flex-col h-full gap-10 items-center justify-center relative z-20">
      <Button
        type="secondary"
        disabled={formState === 'loading' || Boolean(session)}
        onClick={handleGithubSignIn}
        iconLeft={session && <IconCheckCircle />}
        loading={formState === 'loading'}
      >
        Claim your ticket
      </Button>

      <TicketPresence />
    </div>
  )
}