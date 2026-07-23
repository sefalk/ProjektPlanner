"""Unit tests for the shared password policy (#53)."""

from app.auth.password_policy import PASSWORD_MIN_LENGTH, is_password_valid, password_problems


def test_strong_password_has_no_problems():
    assert password_problems("Pw123456789!") == []
    assert is_password_valid("Pw123456789!") is True


def test_too_short_is_flagged():
    problems = password_problems("Aa1!")
    assert any("Zeichen" in p for p in problems)
    assert is_password_valid("Aa1!") is False


def test_missing_classes_are_flagged():
    # long but only lowercase letters → missing upper, digit, special
    problems = password_problems("abcdefghijklmnop")
    assert any("Groß- und Kleinbuchstaben" in p for p in problems)
    assert any("Ziffer" in p for p in problems)
    assert any("Sonderzeichen" in p for p in problems)


def test_min_length_boundary():
    just_short = "Aa1!" + "x" * (PASSWORD_MIN_LENGTH - 5)
    just_right = "Aa1!" + "x" * (PASSWORD_MIN_LENGTH - 4)
    assert is_password_valid(just_short) is False
    assert is_password_valid(just_right) is True
