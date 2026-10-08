import { memo, useCallback, useEffect, useState, type FormEvent } from "react"
import { FAVORITES_LIMIT, FAVORITE_LABEL_LIMIT, FAVORITE_TEXT_LIMIT } from "../constants"
import type { Strings } from "../i18n"
import type { FavoritePrompt } from "../types"

interface ComposerFavoritesProps {
  favorites: FavoritePrompt[]
  // نص الكومبوزر الحالي: زرار الحفظ بيظهر لما فيه كلام فعلًا، ومقارنة
  // التكرار بتتم على النص بنفسه (نفس معيار السيرفر)
  currentText: string
  onSaveCurrent: (text: string) => void
  onUse: (text: string) => void
  onEdit: (id: string, patch: { text?: string; label?: string }) => void
  onRemove: (id: string) => void
  t: Strings
}

// محرر مفضّلة واحدة: اسم العرض + النص الكامل. الاسم الفاضي يرجع للاسم
// المشتق من النص على السيرفر، والنص الفاضي بيمنع الحفظ أصلًا.
function FavoriteEditForm({ favorite, onSave, onCancel, t }: {
  favorite: FavoritePrompt
  onSave: (patch: { text: string; label: string }) => void
  onCancel: () => void
  t: Strings
}) {
  const [label, setLabel] = useState(favorite.label)
  const [text, setText] = useState(favorite.text)
  const cleanText = text.trim()
  const valid = cleanText.length > 0 && cleanText.length <= FAVORITE_TEXT_LIMIT

  const submit = (event: FormEvent<HTMLFormElement>) => {
    // النموذج ده جوه نموذج الكومبوزر (HTML بيسمح بالتداخل في DOM عن طريق
    // React)، فلازم نوقف الحدث هنا وإلا ضغط "حفظ" في المحرر يطلع كمان
    // submit للكومبوزر ويبعت الرسالة المكتوبة.
    event.preventDefault()
    event.stopPropagation()
    if (valid) {
      onSave({ text: cleanText, label: label.trim() })
    }
  }

  return (
    <form className="favorite-edit-form" onSubmit={submit}>
      <label className="favorite-field">
        <span>{t.favoriteLabel}</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={FAVORITE_LABEL_LIMIT} placeholder={t.favoriteLabelPlaceholder} />
      </label>
      <label className="favorite-field">
        <span>{t.favoriteText}</span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} maxLength={FAVORITE_TEXT_LIMIT} placeholder={t.composerPlaceholder} />
      </label>
      <div className="favorite-edit-actions">
        <button type="submit" className="button button-primary" disabled={!valid}>{t.save}</button>
        <button type="button" className="button button-secondary" onClick={onCancel}>{t.cancel}</button>
      </div>
    </form>
  )
}

// الطلبات المفضّلة جوه الكومبوزر: زرار نجمة واحد بيفتح لوحة منزلقة من تحت
// (أنسب للموبايل من قائمة منسدلة صغيرة): لمسة على أي طلب بتستخدمه فورًا
// في الكومبوزر من غير تنفيذ، وبجانبه تعديل (اسم + نص) وحذف. زرار حفظ النص
// الحالي فوق القائمة، فالحفظ من الكومبوزر بيتطلب لمسة واحدة كمان.
function ComposerFavoritesInner({ favorites, currentText, onSaveCurrent, onUse, onEdit, onRemove, t }: ComposerFavoritesProps) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpen(false)
    setEditingId(null)
  }, [])
  const toggle = useCallback(() => {
    setOpen((current) => {
      if (current) {
        setEditingId(null)
      }
      return !current
    })
  }, [])

  // Escape يقفل اللوحة — نفس سلوك الدروار
  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, close])

  const cleanCurrent = currentText.trim()
  const currentSaved = cleanCurrent.length > 0 && favorites.some((favorite) => favorite.text === cleanCurrent)
  const canSaveCurrent = cleanCurrent.length > 0 && cleanCurrent.length <= FAVORITE_TEXT_LIMIT && !currentSaved

  const handleUse = useCallback((favorite: FavoritePrompt) => {
    onUse(favorite.text)
    close()
  }, [onUse, close])

  const handleSaveCurrent = useCallback(() => {
    onSaveCurrent(currentText)
  }, [onSaveCurrent, currentText])

  return (
    <>
      <button
        type="button"
        className={`composer-favorites-toggle${favorites.length > 0 ? " has-items" : ""}`}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t.favoritesTitle} (${favorites.length})`}
        title={`${t.favoritesTitle} ⭐`}
      >
        <span aria-hidden>⭐</span>
        {favorites.length > 0 ? <span className="favorites-toggle-count">{favorites.length}</span> : null}
      </button>
      {open ? (
        <div className="favorites-backdrop" onClick={close}>
          <section
            className="favorites-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t.favoritesTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="favorites-sheet-header">
              <div>
                <div className="eyebrow" aria-hidden>⭐ {favorites.length}/{FAVORITES_LIMIT}</div>
                <h3>{t.favoritesTitle}</h3>
              </div>
              <button type="button" className="icon-button" onClick={close} aria-label={t.close}>×</button>
            </header>
            {canSaveCurrent ? (
              <button type="button" className="favorites-save-current" onClick={handleSaveCurrent}>
                <span aria-hidden>☆</span> {t.favoriteSaveCurrent}
              </button>
            ) : currentSaved ? (
              <div className="favorites-current-saved" role="status">★ {t.favoriteSaved}</div>
            ) : null}
            {favorites.length === 0 ? (
              <div className="empty-state">{t.favoritesEmpty}</div>
            ) : (
              <ul className="favorites-list">
                {favorites.map((favorite) => editingId === favorite.id ? (
                  <li key={favorite.id} className="favorite-item is-editing">
                    <FavoriteEditForm
                      favorite={favorite}
                      t={t}
                      onCancel={() => setEditingId(null)}
                      onSave={(patch) => {
                        onEdit(favorite.id, patch)
                        setEditingId(null)
                      }}
                    />
                  </li>
                ) : (
                  <li key={favorite.id} className="favorite-item">
                    <button type="button" className="favorite-use" onClick={() => handleUse(favorite)} aria-label={`${t.favoriteUse}: ${favorite.label}`}>
                      <span className="favorite-star" aria-hidden>⭐</span>
                      <span className="favorite-body">
                        <span className="favorite-label">{favorite.label}</span>
                        <span className="favorite-preview">{favorite.text}</span>
                      </span>
                    </button>
                    <button type="button" className="favorite-action favorite-edit" onClick={() => setEditingId(favorite.id)} aria-label={t.favoriteEdit} title={t.favoriteEdit}>✎</button>
                    <button type="button" className="favorite-action favorite-remove" onClick={() => onRemove(favorite.id)} aria-label={t.favoriteRemove} title={t.favoriteRemove}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </>
  )
}

export const ComposerFavorites = memo(ComposerFavoritesInner)
