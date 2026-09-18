'use client'

export default function BackToStore() {
  const goBack = () => {
    const referrer =
      typeof document !== 'undefined' && document.referrer
        ? new URL(document.referrer)
        : null
    const sameOrigin = referrer && referrer.origin === window.location.origin
    if (window.history.length > 1 && sameOrigin) {
      window.history.back()
    } else {
      window.location.href = '/products'
    }
  }

  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        borderBottom: '1px solid var(--theme-elevation-100)',
      }}
    >
      <button
        type="button"
        onClick={goBack}
        aria-label="Back to the store"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          width: '100%',
          cursor: 'pointer',
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontFamily: 'inherit',
          fontSize: '0.875rem',
          fontWeight: 500,
          lineHeight: 1,
          color: 'var(--theme-elevation-700)',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: '1.15rem', lineHeight: 1 }}>
          ←
        </span>
        Back
      </button>
    </div>
  )
}