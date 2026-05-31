export function numberToWords(n: number): string {
  const val = Math.round(parseFloat(String(n)) * 100) / 100
  const rupees = Math.floor(val)
  const paise = Math.round((val - rupees) * 100)
  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ]
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function inWords(num: number): string {
    if (num === 0) return 'Zero'
    let str = ''
    if (num >= 10000000) {
      str += inWords(Math.floor(num / 10000000)) + ' Crore '
      num %= 10000000
    }
    if (num >= 100000) {
      str += inWords(Math.floor(num / 100000)) + ' Lakh '
      num %= 100000
    }
    if (num >= 1000) {
      str += inWords(Math.floor(num / 1000)) + ' Thousand '
      num %= 1000
    }
    if (num >= 100) {
      str += a[Math.floor(num / 100)] + ' Hundred '
      num %= 100
    }
    if (num > 0) {
      if (str !== '') str += 'and '
      if (num < 20) {
        str += a[num]
      } else {
        str += b[Math.floor(num / 10)]
        if (num % 10) str += ' ' + a[num % 10]
      }
    }
    return str.trim()
  }

  if (rupees === 0 && paise === 0) return 'Rupees Zero Only'
  let result = 'Rupees ' + inWords(rupees)
  if (paise > 0) result += ' and ' + inWords(paise) + ' Paise'
  return result + ' Only'
}
